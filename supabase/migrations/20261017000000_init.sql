-- Secret Santa schema. See PLAN.md for the reasoning behind each rule.
--
-- Privacy: assignments.receiver_encrypted is encrypted with a key that lives
-- in Supabase Vault. No client role can read the assignments table, and the
-- only read path is get_my_recipient(), which returns the caller's own row.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- The key is generated inside the database so it never appears in the repo.
-- If this secret is lost or changed, every existing pairing becomes unreadable.
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'base64'),
  'secret_santa_key',
  'Encrypts assignments.receiver_encrypted. Do not rotate during an active event.'
)
where not exists (select 1 from vault.secrets where name = 'secret_santa_key');


-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 80),
  invite_code text not null unique,
  invite_enabled boolean not null default true,
  invite_max_uses integer check (invite_max_uses is null or invite_max_uses > 0),
  invite_uses integer not null default 0,
  invite_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create unique index group_members_one_owner on public.group_members (group_id) where role = 'owner';

create table public.events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  budget text,
  exchange_date date not null,
  notes text,
  signup_closes_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'closed', 'drawn')),
  drawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique (group_id, year)
);

create table public.event_participants (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.assignments (
  event_id uuid not null,
  giver_id uuid not null,
  receiver_encrypted bytea not null,
  created_at timestamptz not null default now(),
  primary key (event_id, giver_id),
  foreign key (event_id, giver_id)
    references public.event_participants (event_id, user_id) on delete cascade
);

create table public.event_log (
  id bigint generated always as identity primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index event_log_event_id on public.event_log (event_id, created_at);


-- ---------------------------------------------------------------------------
-- Private helpers (not exposed through the API)
-- ---------------------------------------------------------------------------

create function private.require_user() returns uuid
language plpgsql stable
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'You need to be signed in.' using errcode = '28000';
  end if;
  return uid;
end;
$$;

create function private.is_group_member(gid uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid()
  );
$$;

create function private.is_group_admin(gid uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = gid and user_id = auth.uid() and role in ('owner', 'admin')
  );
$$;

create function private.shares_group(other uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = other
  );
$$;

create function private.santa_key() returns text
language sql stable security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'secret_santa_key';
$$;

create function private.new_invite_code() returns text
language sql volatile
set search_path = ''
as $$
  -- No 0/O/1/I so codes are easy to read aloud.
  select string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), ''
  )
  from (select extensions.gen_random_bytes(8) as b) r, generate_series(0, 7) i;
$$;

create function private.log(eid uuid, act text, det text default null) returns void
language sql volatile security definer
set search_path = ''
as $$
  insert into public.event_log (event_id, actor_id, action, detail)
  values (eid, auth.uid(), act, det);
$$;

revoke all on all functions in schema private from public, anon, authenticated;

-- RLS policies run as the signed-in user, so they need these three. The
-- private schema isn't exposed through the API, so clients still can't call
-- them directly. santa_key() stays locked.
grant usage on schema private to authenticated;
grant execute on function private.is_group_member(uuid) to authenticated;
grant execute on function private.is_group_admin(uuid) to authenticated;
grant execute on function private.shares_group(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

-- Nobody can drop out of an active drawn event. This also fires on cascades,
-- so it blocks leaving a group and deleting an account. remove_participant()
-- moves the event back to 'closed' first, which lets the delete through.
create function private.guard_participant_delete() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = old.event_id;
  if found and ev.status = 'drawn' and ev.exchange_date >= current_date then
    raise exception 'This person is in the % draw. An admin has to remove them from the event first.', ev.year
      using errcode = 'P0001';
  end if;
  return old;
end;
$$;

create trigger event_participants_guard_delete
before delete on public.event_participants
for each row execute function private.guard_participant_delete();

create function private.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();


-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Clients only read directly. Every write goes through a function below.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.events enable row level security;
alter table public.event_participants enable row level security;
alter table public.assignments enable row level security;
alter table public.event_log enable row level security;

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;
revoke all on public.assignments from authenticated;

create policy "see yourself and people in your groups" on public.profiles
  for select to authenticated
  using (id = auth.uid() or private.shares_group(id));

grant update (display_name) on public.profiles to authenticated;
create policy "edit your own name" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "members see their groups" on public.groups
  for select to authenticated
  using (private.is_group_member(id));

create policy "members see the member list" on public.group_members
  for select to authenticated
  using (private.is_group_member(group_id));

create policy "members see events" on public.events
  for select to authenticated
  using (private.is_group_member(group_id));

create policy "members see who joined" on public.event_participants
  for select to authenticated
  using (private.is_group_member((select group_id from public.events e where e.id = event_id)));

create policy "members see the event log" on public.event_log
  for select to authenticated
  using (private.is_group_member((select group_id from public.events e where e.id = event_id)));

-- public.assignments: RLS on, no policies, no grants. Unreadable by clients.


-- ---------------------------------------------------------------------------
-- Groups
-- ---------------------------------------------------------------------------

create function public.create_group(group_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  gid uuid;
begin
  insert into public.groups (name, invite_code)
  values (trim(group_name), private.new_invite_code())
  returning id into gid;

  insert into public.group_members (group_id, user_id, role) values (gid, uid, 'owner');
  return gid;
end;
$$;

create function public.join_group(code text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  g public.groups;
  inserted int;
begin
  select * into g from public.groups
  where invite_code = upper(trim(code))
  for update;

  if not found or not g.invite_enabled
     or (g.invite_expires_at is not null and g.invite_expires_at < now())
     or (g.invite_max_uses is not null and g.invite_uses >= g.invite_max_uses) then
    raise exception 'That invite code isn''t valid.' using errcode = 'P0001';
  end if;

  insert into public.group_members (group_id, user_id) values (g.id, uid)
  on conflict do nothing;
  get diagnostics inserted = row_count;

  if inserted > 0 then
    update public.groups set invite_uses = invite_uses + 1 where id = g.id;
  end if;
  return g.id;
end;
$$;

create function public.rotate_invite(gid uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  code text;
begin
  perform private.require_user();
  if not private.is_group_admin(gid) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;

  update public.groups
  set invite_code = private.new_invite_code(), invite_uses = 0
  where id = gid
  returning invite_code into code;
  return code;
end;
$$;

create function public.set_invite_settings(
  gid uuid, enabled boolean, max_uses integer, expires_at timestamptz
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not private.is_group_admin(gid) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;

  update public.groups
  set invite_enabled = enabled, invite_max_uses = max_uses, invite_expires_at = expires_at
  where id = gid;
end;
$$;

create function public.set_member_role(gid uuid, member uuid, new_role text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
begin
  if not exists (
    select 1 from public.group_members where group_id = gid and user_id = uid and role = 'owner'
  ) then
    raise exception 'Only the group owner can change roles.' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'member') then
    raise exception 'Role must be admin or member.' using errcode = '22023';
  end if;
  if member = uid then
    raise exception 'The owner''s role can''t be changed.' using errcode = 'P0001';
  end if;

  update public.group_members set role = new_role where group_id = gid and user_id = member;
end;
$$;

-- Shared by leave_group and remove_member. The participant guard blocks this
-- if the person is in an active drawn event.
create function private.drop_member(gid uuid, member uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.group_members where group_id = gid and user_id = member and role = 'owner'
  ) then
    raise exception 'The group owner can''t leave the group.' using errcode = 'P0001';
  end if;

  delete from public.event_participants ep
  using public.events e
  where e.id = ep.event_id and e.group_id = gid and ep.user_id = member;

  delete from public.group_members where group_id = gid and user_id = member;
end;
$$;

revoke all on function private.drop_member(uuid, uuid) from public, anon, authenticated;

create function public.leave_group(gid uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.drop_member(gid, private.require_user());
end;
$$;

create function public.remove_member(gid uuid, member uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_user();
  if not private.is_group_admin(gid) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;
  perform private.drop_member(gid, member);
end;
$$;


-- ---------------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------------

create function public.create_event(
  gid uuid, event_year integer, event_budget text, event_exchange_date date,
  event_notes text, event_signup_closes_at timestamptz
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  perform private.require_user();
  if not private.is_group_admin(gid) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;

  insert into public.events (group_id, year, budget, exchange_date, notes, signup_closes_at)
  values (gid, event_year, event_budget, event_exchange_date, event_notes, event_signup_closes_at)
  returning id into eid;

  perform private.log(eid, 'created');
  return eid;
end;
$$;

create function public.update_event(
  eid uuid, event_budget text, event_exchange_date date,
  event_notes text, event_signup_closes_at timestamptz
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  perform private.require_user();
  select * into ev from public.events where id = eid for update;
  if not found or not private.is_group_admin(ev.group_id) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;
  if ev.status = 'drawn' then
    raise exception 'The draw has already run. Rules are locked.' using errcode = 'P0001';
  end if;

  update public.events
  set budget = event_budget, exchange_date = event_exchange_date,
      notes = event_notes, signup_closes_at = event_signup_closes_at
  where id = eid;
end;
$$;

create function public.join_event(eid uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  ev public.events;
begin
  select * into ev from public.events where id = eid;
  if not found or not private.is_group_member(ev.group_id) then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;
  if ev.status <> 'open' or now() >= ev.signup_closes_at then
    raise exception 'Signups for % are closed.', ev.year using errcode = 'P0001';
  end if;

  insert into public.event_participants (event_id, user_id) values (eid, uid)
  on conflict do nothing;
end;
$$;

create function public.leave_event(eid uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  ev public.events;
begin
  select * into ev from public.events where id = eid;
  if not found or not private.is_group_member(ev.group_id) then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;
  if ev.status = 'drawn' then
    raise exception 'The draw has already run. Ask an admin to remove you.' using errcode = 'P0001';
  end if;

  delete from public.event_participants where event_id = eid and user_id = uid;
end;
$$;

create function public.close_signups(eid uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  perform private.require_user();
  select * into ev from public.events where id = eid for update;
  if not found or not private.is_group_admin(ev.group_id) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;
  if ev.status <> 'open' then
    return;
  end if;

  update public.events set status = 'closed' where id = eid;
  perform private.log(eid, 'signups_closed');
end;
$$;

-- Removing someone after the draw throws the draw away. The admin has to run
-- it again, and both steps show up in the event log.
create function public.remove_participant(eid uuid, member uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  ev public.events;
  name text;
begin
  perform private.require_user();
  select * into ev from public.events where id = eid for update;
  if not found or not private.is_group_admin(ev.group_id) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;

  select display_name into name from public.profiles where id = member;

  if ev.status = 'drawn' then
    delete from public.assignments where event_id = eid;
    update public.events set status = 'closed', drawn_at = null where id = eid;
    perform private.log(eid, 'draw_cleared', 'Removed ' || coalesce(name, 'someone') || ' after the draw');
  end if;

  delete from public.event_participants where event_id = eid and user_id = member;
  perform private.log(eid, 'participant_removed', name);
end;
$$;


-- ---------------------------------------------------------------------------
-- The draw
-- ---------------------------------------------------------------------------

-- Shuffle participants, then each person gives to the next one in the list
-- and the last gives to the first. One big loop, nobody draws themselves.
-- The plain pairing only exists in the local array below.
create function public.run_draw(eid uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  ev public.events;
  ids uuid[];
  n int;
  k text;
  was_drawn_before boolean;
begin
  perform private.require_user();
  select * into ev from public.events where id = eid for update;
  if not found or not private.is_group_admin(ev.group_id) then
    raise exception 'Only group admins can do that.' using errcode = '42501';
  end if;
  if ev.status = 'drawn' then
    raise exception 'The draw has already run.' using errcode = 'P0001';
  end if;
  if ev.status = 'open' and now() < ev.signup_closes_at then
    raise exception 'Close signups before running the draw.' using errcode = 'P0001';
  end if;

  -- gen_random_uuid() draws from a cryptographic random source.
  select array_agg(user_id order by gen_random_uuid()) into ids
  from public.event_participants where event_id = eid;
  n := coalesce(array_length(ids, 1), 0);

  if n < 3 then
    raise exception 'You need at least 3 people to run the draw.' using errcode = 'P0001';
  end if;

  k := private.santa_key();
  if k is null then
    raise exception 'Encryption key is missing from Vault.' using errcode = 'P0001';
  end if;

  insert into public.assignments (event_id, giver_id, receiver_encrypted)
  select eid, ids[i], extensions.pgp_sym_encrypt(ids[(i % n) + 1]::text, k)
  from generate_series(1, n) i;

  select exists (
    select 1 from public.event_log where event_id = eid and action in ('drawn', 'redrawn')
  ) into was_drawn_before;

  update public.events set status = 'drawn', drawn_at = now() where id = eid;
  perform private.log(eid, case when was_drawn_before then 'redrawn' else 'drawn' end, n || ' people');
end;
$$;

-- Returns the caller's own recipient and nothing else.
create function public.get_my_recipient(eid uuid)
returns table (user_id uuid, display_name text)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  uid uuid := private.require_user();
  receiver uuid;
begin
  select extensions.pgp_sym_decrypt(a.receiver_encrypted, private.santa_key())::uuid
  into receiver
  from public.assignments a
  where a.event_id = eid and a.giver_id = uid;

  if receiver is null then
    return;
  end if;

  return query
  select p.id, p.display_name from public.profiles p where p.id = receiver;
end;
$$;


-- ---------------------------------------------------------------------------
-- Function grants: signed-in users only
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
