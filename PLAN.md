# Secret Santa — Plan

## Goal

A Secret Santa app for groups that come back every year. People log in, join a
group with an invite link, opt in to that year's event, and see who they're
buying for. Nobody — including the person who runs the database — can see the
pairings at a glance.

## Stack

- **Frontend:** Vite + React + TypeScript + React Router + shadcn/ui (default theme)
- **Backend:** Supabase — Auth, Postgres, Vault. No custom server.
- **Migrations:** Supabase CLI, in `supabase/migrations/`
- **Hosting:** Railway, as a static build. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Auth

- Supabase email + password.
- Email confirmation **off** — the invite code is the real gate.
- Built-in Supabase mailer for password resets. Move to custom SMTP (Resend) only
  if resets start going missing.
- Display name set at signup, stored in `profiles`.

## Privacy model ("don't see it by accident")

The bar: opening the table editor must not show who has whom. Getting the answer
should take 2–3 deliberate steps.

- `assignments.receiver_encrypted` is encrypted with `pgp_sym_encrypt` (pgcrypto).
  It is randomized, so two rows with the same recipient look different.
- The encryption key lives in **Supabase Vault** (`secret_santa_key`), not in any table.
- RLS blocks all direct reads of `assignments`.
- The only read path is `get_my_recipient(event_id)` — it decrypts the single row
  where `giver_id = auth.uid()`.
- There is **no** function that returns more than one pairing. No reveal-all, ever.
- The plain pairing only exists in memory inside `run_draw`.

## Data model

```
profiles           (id → auth.users, display_name)
groups             (id, name, invite_code, invite_max_uses,
                    invite_uses, invite_expires_at, invite_enabled)
group_members      (group_id, user_id, role: owner | admin | member)
events             (id, group_id, year, budget, exchange_date, notes,
                    signup_closes_at, status: open | closed | drawn)
event_participants (event_id, user_id)
assignments        (event_id, giver_id, receiver_encrypted)
event_log          (event_id, actor_id, action, detail, created_at)
```

## Roles

- Anyone signed in can create a group and becomes its **owner** (one per group, stored as a role in `group_members`; the owner can't leave).
- The owner can make members **admins**.
- Admins create events, close signups, run the draw, remove participants.
- Admins are participants too, and just as blind as everyone else.

## Flows

1. **Create group** → you are owner. A random invite code is generated.
2. **Join** via `/join/CODE`. The owner can rotate or disable the code and set
   max uses / expiry.
3. **Create event** for a year: budget, exchange date, notes, signup deadline.
4. **Opt in.** Members press "Join this year". The live participant list is
   visible to everyone in the group.
5. **Close signups** — automatically at `signup_closes_at`, or early by an admin.
6. **Run draw** (admin, signups closed, ≥ 3 participants): shuffle, each person
   gives to the next one in the list, last gives to first. One big loop, nobody
   draws themselves. Encrypt, insert, log.
7. **Announce.** Admin page has a "Copy announcement" button for the group chat.
8. **Reveal.** Each participant presses "Reveal your person" → `get_my_recipient`.

## After the draw

- **No late joins.**
- **Removing a participant** sends the event back to `closed` and wipes
  assignments. The admin must re-run the draw. Every remove and re-draw is
  written to `event_log`, which all participants can see.
- **Leaving a group / deleting an account** is blocked while you are in an
  active drawn event (status `drawn` and `exchange_date` not yet passed).
  An admin has to remove you first. Enforced by a `before delete` trigger on
  `event_participants`, which also fires on cascades from account deletion.

## Rules for the year

Display only: `budget`, `exchange_date`, `notes` (markdown). The draw has no
constraints beyond "not yourself".

## Not doing

- Draw constraints (couples, no repeats from last year)
- Wishlists, addresses
- Email notifications
- Big reveal after the exchange
- Passkeys / client-side crypto
