import { useCallback, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmButton } from '@/components/ConfirmButton'
import { EventForm, type EventFormValues } from '@/components/EventForm'
import { Layout } from '@/components/Layout'
import { signupsOpen, StatusBadge } from '@/components/StatusBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/lib/auth'
import { copy } from '@/lib/clipboard'
import { errorMessage } from '@/lib/errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import type { Tables } from '@/lib/database.types'

type EventWithGroup = Tables<'events'> & { groups: { name: string } | null }
type Participant = { user_id: string; profiles: { display_name: string } | null }
type LogEntry = Pick<Tables<'event_log'>, 'id' | 'action' | 'detail' | 'created_at'> & {
  profiles: { display_name: string } | null
}

const MIN_PARTICIPANTS = 3

export default function EventPage() {
  const { eventId = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id

  const [event, setEvent] = useState<EventWithGroup | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [log, setLog] = useState<LogEntry[]>([])
  const [myRole, setMyRole] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    const { data: ev, error } = await supabase
      .from('events')
      .select('*, groups(name)')
      .eq('id', eventId)
      .maybeSingle()
    if (error) toast.error(errorMessage(error))
    setEvent(ev)
    if (!ev) return setLoaded(true)

    const [p, l, r] = await Promise.all([
      supabase.from('event_participants').select('user_id, profiles(display_name)').eq('event_id', eventId).order('joined_at'),
      supabase
        .from('event_log')
        .select('id, action, detail, created_at, profiles(display_name)')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false }),
      supabase.from('group_members').select('role').eq('group_id', ev.group_id).eq('user_id', me ?? '').maybeSingle(),
    ])
    const err = p.error ?? l.error ?? r.error
    if (err) toast.error(errorMessage(err))
    setParticipants(p.data ?? [])
    setLog(l.data ?? [])
    setMyRole(r.data?.role ?? null)
    setLoaded(true)
  }, [eventId, me])

  useEffect(() => {
    load()
  }, [load])

  if (!loaded) return <Layout>{null}</Layout>
  if (!event) {
    return (
      <Layout>
        <p className="text-sm text-muted-foreground">
          This event doesn’t exist, or you’re not in its group. <Link to="/" className="underline">Go home</Link>
        </p>
      </Layout>
    )
  }

  const isAdmin = myRole === 'owner' || myRole === 'admin'
  const imIn = participants.some((p) => p.user_id === me)
  const open = signupsOpen(event)
  const drawn = event.status === 'drawn'
  const canDraw = !drawn && !open && participants.length >= MIN_PARTICIPANTS
  const groupName = event.groups?.name ?? 'Group'

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

  function saveRules(v: EventFormValues) {
    return rpc(
      () =>
        supabase.rpc('update_event', {
          eid: eventId,
          event_budget: v.budget as string,
          event_exchange_date: v.exchangeDate,
          event_notes: v.notes as string,
          event_signup_closes_at: v.signupClosesAt,
        }),
      'Rules saved',
    ).then((ok) => {
      if (ok) setEditing(false)
      return ok
    })
  }

  const announcement =
    `🎁 The ${groupName} ${event.year} Secret Santa draw is done! ` +
    `See who you’re buying for: ${window.location.origin}/e/${event.id}` +
    (event.budget ? `\nBudget: ${event.budget}` : '') +
    `\nExchange: ${formatDate(event.exchange_date)}`

  return (
    <Layout>
      <div className="flex flex-col gap-1">
        <Link to={`/g/${event.group_id}`} className="text-sm text-muted-foreground hover:underline">
          ← {groupName}
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold">Secret Santa {event.year}</h1>
          <StatusBadge event={event} />
        </div>
      </div>

      {drawn && imIn && <RevealCard eventId={event.id} />}
      {drawn && !imIn && (
        <Alert>
          <AlertDescription>You’re not in this year’s draw.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
          {isAdmin && !drawn && !editing && (
            <CardAction>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {editing ? (
            <EventForm
              initial={{
                year: event.year,
                budget: event.budget,
                exchangeDate: event.exchange_date,
                signupClosesAt: event.signup_closes_at,
                notes: event.notes,
              }}
              submitLabel="Save rules"
              onSubmit={saveRules}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Budget</dt>
                <dd>{event.budget ?? 'No limit set'}</dd>
                <dt className="text-muted-foreground">Exchange</dt>
                <dd>{formatDate(event.exchange_date)}</dd>
                <dt className="text-muted-foreground">Signups close</dt>
                <dd>{formatDateTime(event.signup_closes_at)}</dd>
              </dl>
              {event.notes && (
                <div className="prose-sm text-sm [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc">
                  <Markdown>{event.notes}</Markdown>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Who’s in</CardTitle>
          <CardDescription>
            {participants.length} {participants.length === 1 ? 'person' : 'people'}
            {open && ' so far'}
          </CardDescription>
          {open && (
            <CardAction>
              {imIn ? (
                <Button variant="outline" size="sm" onClick={() => rpc(() => supabase.rpc('leave_event', { eid: eventId }), 'You’re out')}>
                  Leave
                </Button>
              ) : (
                <Button size="sm" onClick={() => rpc(() => supabase.rpc('join_event', { eid: eventId }), 'You’re in!')}>
                  Join this year
                </Button>
              )}
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          {participants.length === 0 && <p className="text-sm text-muted-foreground">Nobody yet.</p>}
          {participants.map((p) => {
            const name = p.profiles?.display_name ?? 'Unknown'
            return (
              <div key={p.user_id} className="flex items-center justify-between px-2 py-1.5">
                <span>
                  {name}
                  {p.user_id === me && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                </span>
                {isAdmin && (
                  <ConfirmButton
                    variant="destructive"
                    size="sm"
                    title={`Remove ${name} from ${event.year}?`}
                    description={
                      drawn
                        ? 'The draw has already run. Removing someone throws it away, and you’ll need to run it again. Everyone gets a new person, and the event log will show this.'
                        : 'They can join again while signups are open.'
                    }
                    confirmLabel={drawn ? 'Remove and clear draw' : 'Remove'}
                    onConfirm={() =>
                      rpc(() => supabase.rpc('remove_participant', { eid: eventId, member: p.user_id }), `${name} removed`)
                    }
                  >
                    Remove
                  </ConfirmButton>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Admin</CardTitle>
            <CardDescription>
              {drawn
                ? 'The draw is done and the rules are locked. Removing someone clears the draw so you can run it again.'
                : open
                  ? 'Close signups when everyone’s in, then run the draw.'
                  : participants.length < MIN_PARTICIPANTS
                    ? `You need at least ${MIN_PARTICIPANTS} people to run the draw.`
                    : 'Ready to draw. You won’t be able to see the pairings either.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {open && (
              <ConfirmButton
                variant="outline"
                title="Close signups now?"
                description="Nobody else will be able to join this year’s event."
                confirmLabel="Close signups"
                onConfirm={() => rpc(() => supabase.rpc('close_signups', { eid: eventId }), 'Signups closed')}
              >
                Close signups
              </ConfirmButton>
            )}
            {!drawn && (
              <ConfirmButton
                disabled={!canDraw}
                title={`Run the ${event.year} draw?`}
                description={`${participants.length} people will each get someone to buy for. After this, the rules are locked and nobody new can join.`}
                confirmLabel="Run draw"
                onConfirm={() => rpc(() => supabase.rpc('run_draw', { eid: eventId }), 'Draw complete')}
              >
                Run draw
              </ConfirmButton>
            )}
            {drawn && <Button onClick={() => copy(announcement, 'Announcement copied')}>Copy announcement</Button>}
          </CardContent>
        </Card>
      )}

      {log.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Every draw and removal shows up here for everyone.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {log.map((l) => (
                <li key={l.id} className="flex justify-between gap-4">
                  <span>
                    {describe(l)}
                    {l.profiles && <span className="text-muted-foreground"> by {l.profiles.display_name}</span>}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{formatDateTime(l.created_at)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </Layout>
  )
}

function RevealCard({ eventId }: { eventId: string }) {
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function reveal() {
    setBusy(true)
    const { data, error } = await supabase.rpc('get_my_recipient', { eid: eventId })
    setBusy(false)
    if (error) return toast.error(errorMessage(error))
    const recipient = data?.[0]
    if (!recipient) return toast.error('No pairing found. Ask an admin to check the draw.')
    setName(recipient.display_name)
  }

  return (
    <Card className="text-center">
      <CardContent className="flex flex-col items-center gap-4 py-6">
        {name ? (
          <>
            <p className="text-sm text-muted-foreground">You’re buying for</p>
            <p className="font-heading text-3xl font-semibold">{name}</p>
            <Button variant="ghost" size="sm" onClick={() => setName(null)}>Hide</Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">The draw is done.</p>
            <Button size="lg" onClick={reveal} disabled={busy}>Reveal your person</Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function describe(l: LogEntry): string {
  switch (l.action) {
    case 'created': return 'Event created'
    case 'signups_closed': return 'Signups closed'
    case 'drawn': return `Draw run (${l.detail})`
    case 'redrawn': return `Draw re-run (${l.detail})`
    case 'draw_cleared': return `Draw cleared: ${l.detail}`
    case 'participant_removed': return `${l.detail ?? 'Someone'} removed`
    default: return l.action
  }
}
