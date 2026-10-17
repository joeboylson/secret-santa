// End-to-end check against local Supabase: `supabase start`, then `node scripts/smoke-test.mjs`.
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54421'
const KEY = process.env.SUPABASE_ANON_KEY
if (!KEY) throw new Error('Set SUPABASE_ANON_KEY (from `supabase status`)')

let failures = 0
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failures++ }
const run = Date.now()

async function user(name) {
  const c = createClient(URL, KEY, { auth: { persistSession: false } })
  const { data, error } = await c.auth.signUp({
    email: `${name}-${run}@test.local`, password: 'password123',
    options: { data: { display_name: name } },
  })
  if (error) throw error
  return { c, id: data.user.id, name }
}

const [joe, alex, sam, dana] = await Promise.all(['Joe', 'Alex', 'Sam', 'Dana'].map(user))
const everyone = [joe, alex, sam, dana]

const { data: gid } = await joe.c.rpc('create_group', { group_name: 'Family' })
const { data: g } = await joe.c.from('groups').select('invite_code').eq('id', gid).single()
for (const u of [alex, sam, dana]) {
  const { error } = await u.c.rpc('join_group', { code: g.invite_code.toLowerCase() })
  check(!error, `${u.name} joins with invite code`)
}

const { data: eid, error: evErr } = await joe.c.rpc('create_event', {
  gid, event_year: 2026, event_budget: '$50', event_exchange_date: '2026-12-24',
  event_notes: 'Handmade only', event_signup_closes_at: '2026-12-01T00:00:00Z',
})
check(!evErr, 'admin creates event')
check(!!(await alex.c.rpc('create_event', {
  gid, event_year: 2027, event_budget: null, event_exchange_date: '2027-12-24',
  event_notes: null, event_signup_closes_at: '2027-12-01T00:00:00Z',
})).error, 'non-admin cannot create event')

for (const u of everyone) await u.c.rpc('join_event', { eid })
const { data: parts } = await sam.c.from('event_participants').select('user_id').eq('event_id', eid)
check(parts.length === 4, 'everyone can see all 4 participants')

check(!!(await joe.c.rpc('run_draw', { eid })).error, 'draw refused while signups open')
check(!!(await alex.c.rpc('close_signups', { eid })).error, 'non-admin cannot close signups')
await joe.c.rpc('close_signups', { eid })
check(!!(await alex.c.rpc('run_draw', { eid })).error, 'non-admin cannot run draw')
check(!(await joe.c.rpc('run_draw', { eid })).error, 'admin runs draw')

const got = {}
for (const u of everyone) {
  const { data } = await u.c.rpc('get_my_recipient', { eid })
  got[u.id] = data?.[0]?.user_id
}
const receivers = Object.values(got)
check(receivers.every(Boolean), 'each person gets exactly one recipient')
check(everyone.every((u) => got[u.id] !== u.id), 'nobody drew themselves')
check(new Set(receivers).size === 4, 'everyone receives exactly once')
let len = 0, cur = joe.id
do { cur = got[cur]; len++ } while (cur !== joe.id && len < 10)
check(len === 4, 'pairings form one big loop')

const { data: direct, error: directErr } = await joe.c.from('assignments').select('*')
check(!!directErr || direct.length === 0, 'assignments table is unreadable from the client')
check(!!(await joe.c.schema('private').rpc('santa_key')).error, 'cannot call santa_key()')

const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (SERVICE) {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } })
  check(!!(await admin.auth.admin.deleteUser(sam.id)).error, 'deleting an account during active draw is blocked')
}

const { error: leaveErr } = await dana.c.rpc('leave_group', { gid })
check(!!leaveErr, `leaving during active draw is blocked (${leaveErr?.message})`)
check(!!(await dana.c.rpc('leave_event', { eid })).error, 'leave_event blocked after draw')
check(!!(await joe.c.rpc('update_event', {
  eid, event_budget: '$5', event_exchange_date: '2026-12-24', event_notes: null,
  event_signup_closes_at: '2026-12-01T00:00:00Z',
})).error, 'rules locked after draw')

check(!(await joe.c.rpc('remove_participant', { eid, member: dana.id })).error, 'admin removes Dana after draw')
const { data: ev } = await alex.c.from('events').select('status').eq('id', eid).single()
check(ev.status === 'closed', 'event goes back to closed')
const { data: none } = await alex.c.rpc('get_my_recipient', { eid })
check(none.length === 0, 'old pairings are gone')
check(!(await joe.c.rpc('run_draw', { eid })).error, 're-draw with 3 people')
check(!(await dana.c.rpc('leave_group', { gid })).error, 'Dana can leave now')

const { data: log } = await alex.c.from('event_log').select('action').eq('event_id', eid).order('created_at')
const actions = log.map((l) => l.action).join(', ')
check(actions.includes('draw_cleared') && actions.includes('redrawn'), `log visible to members: ${actions}`)

console.log(failures ? `\n${failures} failed` : '\nAll passed')
process.exit(failures ? 1 : 0)
