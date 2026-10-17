import { Badge } from '@/components/ui/badge'
import type { Tables } from '@/lib/database.types'

type Props = { event: Pick<Tables<'events'>, 'status' | 'signup_closes_at'> }

export function signupsOpen(event: Props['event']): boolean {
  return event.status === 'open' && new Date(event.signup_closes_at) > new Date()
}

export function StatusBadge({ event }: Props) {
  if (event.status === 'drawn') return <Badge>Drawn</Badge>
  if (signupsOpen(event)) return <Badge variant="outline">Signups open</Badge>
  return <Badge variant="secondary">Signups closed</Badge>
}
