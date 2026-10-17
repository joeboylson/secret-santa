import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmButton } from '@/components/ConfirmButton'
import { EventForm, type EventFormValues } from '@/components/EventForm'
import { Layout } from '@/components/Layout'
import { StatusBadge } from '@/components/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { useAuth } from '@/lib/auth'
import { copy } from '@/lib/clipboard'
import { errorMessage } from '@/lib/errors'
import { formatDate, fromLocalInput, toLocalInput } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

type Member = { user_id: string; role: string; profiles: { display_name: string } | null }
type EventRow = Pick<Tables<'events'>, 'id' | 'year' | 'status' | 'exchange_date' | 'signup_closes_at'>

export default function GroupPage() {
  const { groupId = '' } = useParams()
  const { session } = useAuth()
  const navigate = useNavigate()
  const me = session?.user.id

  const [group, setGroup] = useState<Tables<'groups'> | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [g, m, e] = await Promise.all([
      supabase.from('groups').select('*').eq('id', groupId).maybeSingle(),
      supabase.from('group_members').select('user_id, role, profiles(display_name)').eq('group_id', groupId),
      supabase.from('events').select('id, year, status, exchange_date, signup_closes_at').eq('group_id', groupId).order('year', { ascending: false }),
    ])
    const error = g.error ?? m.error ?? e.error
    if (error) toast.error(errorMessage(error))
    setGroup(g.data)
    setMembers(sortMembers(m.data ?? []))
    setEvents(e.data ?? [])
    setLoaded(true)
  }, [groupId])

  useEffect(() => {
    load()
  }, [load])

  if (!loaded) return <Layout>{null}</Layout>
  if (!group) {
    return (
      <Layout>
        <p className="text-sm text-muted-foreground">
          This group doesn’t exist, or you’re not in it. <Link to="/" className="underline">Go home</Link>
        </p>
      </Layout>
    )
  }

  const myRole = members.find((m) => m.user_id === me)?.role
  const isAdmin = myRole === 'owner' || myRole === 'admin'
  const isOwner = myRole === 'owner'

  async function rpc(fn: () => PromiseLike<{ error: unknown }>, success?: string) {
    const { error } = await fn()
    if (error) {
      toast.error(errorMessage(error))
      return false
    }
    if (success) toast.success(success)
    await load()
    return true
  }

  async function createEvent(v: EventFormValues) {
    const { data, error } = await supabase.rpc('create_event', {
      gid: groupId,
      event_year: v.year,
      event_budget: v.budget as string,
      event_exchange_date: v.exchangeDate,
      event_notes: v.notes as string,
      event_signup_closes_at: v.signupClosesAt,
    })
    if (error) {
      toast.error(error.code === '23505' ? `There’s already a ${v.year} event.` : errorMessage(error))
      return false
    }
    navigate(`/e/${data}`)
    return true
  }

  async function leave() {
    const { error } = await supabase.rpc('leave_group', { gid: groupId })
    if (error) return toast.error(errorMessage(error))
    navigate('/', { replace: true })
  }

  return (
    <Layout>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </p>
        </div>
        {!isOwner && (
          <ConfirmButton
            variant="ghost"
            size="sm"
            title={`Leave ${group.name}?`}
            description="You’ll need a new invite link to come back."
            confirmLabel="Leave group"
            onConfirm={leave}
          >
            Leave
          </ConfirmButton>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {events.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No events yet.{isAdmin ? ' Create this year’s below.' : ' An admin will set one up.'}
            </p>
          )}
          {events.map((e) => (
            <Link
              key={e.id}
              to={`/e/${e.id}`}
              className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-muted"
            >
              <span className="font-medium">{e.year}</span>
              <span className="flex items-center gap-3 text-sm text-muted-foreground">
                {formatDate(e.exchange_date)}
                <StatusBadge event={e} />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>New event</CardTitle>
            <CardDescription>One per year. Members opt in until signups close.</CardDescription>
          </CardHeader>
          <CardContent>
            <EventForm showYear submitLabel="Create event" onSubmit={createEvent} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {members.map((m) => {
            const name = m.profiles?.display_name ?? 'Unknown'
            const canManage = m.role !== 'owner' && m.user_id !== me
            return (
              <div key={m.user_id} className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="flex items-center gap-2">
                  {name}
                  {m.user_id === me && <span className="text-xs text-muted-foreground">(you)</span>}
                  {m.role !== 'member' && <Badge variant="secondary">{m.role}</Badge>}
                </span>
                <span className="flex gap-1">
                  {isOwner && canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        rpc(() =>
                          supabase.rpc('set_member_role', {
                            gid: groupId,
                            member: m.user_id,
                            new_role: m.role === 'admin' ? 'member' : 'admin',
                          }),
                        )
                      }
                    >
                      {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                    </Button>
                  )}
                  {isAdmin && canManage && (
                    <ConfirmButton
                      variant="destructive"
                      size="sm"
                      title={`Remove ${name}?`}
                      description="They’ll lose access to the group and need a new invite link to come back."
                      confirmLabel="Remove"
                      onConfirm={() =>
                        rpc(() => supabase.rpc('remove_member', { gid: groupId, member: m.user_id }), `${name} removed`)
                      }
                    >
                      Remove
                    </ConfirmButton>
                  )}
                </span>
              </div>
            )
          })}
        </CardContent>
      </Card>

      {isAdmin && <InviteCard key={String(group.invite_enabled)} group={group} onChange={load} />}
    </Layout>
  )
}

function InviteCard({ group, onChange }: { group: Tables<'groups'>; onChange: () => Promise<void> }) {
  const link = `${window.location.origin}/join/${group.invite_code}`
  const expired = group.invite_expires_at !== null && new Date(group.invite_expires_at) < new Date()
  const usedUp = group.invite_max_uses !== null && group.invite_uses >= group.invite_max_uses
  const [enabled, setEnabled] = useState(group.invite_enabled)

  async function rotate() {
    const { error } = await supabase.rpc('rotate_invite', { gid: group.id })
    if (error) return toast.error(errorMessage(error))
    toast.success('New link created. The old one no longer works.')
    await onChange()
  }

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const maxUses = String(f.get('maxUses') ?? '').trim()
    const expires = String(f.get('expires') ?? '').trim()
    const { error } = await supabase.rpc('set_invite_settings', {
      gid: group.id,
      enabled,
      max_uses: (maxUses ? Number(maxUses) : null) as number,
      expires_at: (expires ? fromLocalInput(expires) : null) as string,
    })
    if (error) return toast.error(errorMessage(error))
    toast.success('Invite settings saved')
    await onChange()
  }

  const status = !group.invite_enabled ? 'Turned off' : expired ? 'Expired' : usedUp ? 'Used up' : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite link</CardTitle>
        <CardDescription>Anyone with this link can join the group.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-2">
          <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button onClick={() => copy(link, 'Invite link copied')}>Copy</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          {status && <Badge variant="destructive">{status}</Badge>}
          <span>
            Used {group.invite_uses}
            {group.invite_max_uses !== null && ` of ${group.invite_max_uses}`} times
          </span>
          <ConfirmButton
            variant="outline"
            size="sm"
            title="Make a new link?"
            description="The current link stops working right away. People already in the group stay in."
            confirmLabel="Make new link"
            onConfirm={rotate}
          >
            New link
          </ConfirmButton>
        </div>

        <Separator />

        <form onSubmit={save} className="flex flex-col gap-4">
          <label className="flex items-center gap-3 text-sm">
            <Switch checked={enabled} onCheckedChange={setEnabled} />
            Link is on
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="maxUses">Max uses</Label>
              <Input
                id="maxUses"
                name="maxUses"
                type="number"
                min={1}
                placeholder="No limit"
                defaultValue={group.invite_max_uses ?? ''}
                key={`max-${group.invite_max_uses}`}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="expires">Expires</Label>
              <Input
                id="expires"
                name="expires"
                type="datetime-local"
                defaultValue={group.invite_expires_at ? toLocalInput(group.invite_expires_at) : ''}
                key={`exp-${group.invite_expires_at}`}
              />
            </div>
          </div>
          <div>
            <Button type="submit" variant="outline">Save settings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2 }

function sortMembers(members: Member[]): Member[] {
  return [...members].sort(
    (a, b) =>
      roleOrder[a.role] - roleOrder[b.role] ||
      (a.profiles?.display_name ?? '').localeCompare(b.profiles?.display_name ?? ''),
  )
}
