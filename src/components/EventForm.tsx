import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { fromLocalInput, toLocalInput } from '@/lib/format'

export type EventFormValues = {
  year: number
  budget: string | null
  exchangeDate: string
  signupClosesAt: string
  notes: string | null
}

type Props = {
  initial?: EventFormValues
  showYear?: boolean
  submitLabel: string
  onSubmit: (values: EventFormValues) => Promise<boolean>
  onCancel?: () => void
}

export function defaultEventValues(): EventFormValues {
  const now = new Date()
  // After Christmas, default to next year's event.
  const year = now.getMonth() === 11 && now.getDate() > 25 ? now.getFullYear() + 1 : now.getFullYear()
  return {
    year,
    budget: null,
    exchangeDate: `${year}-12-24`,
    signupClosesAt: new Date(year, 11, 1, 23, 59).toISOString(),
    notes: null,
  }
}

export function EventForm({ initial = defaultEventValues(), showYear, submitLabel, onSubmit, onCancel }: Props) {
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const f = new FormData(form)
    const text = (k: string) => String(f.get(k) ?? '').trim() || null
    setBusy(true)
    const ok = await onSubmit({
      year: showYear ? Number(f.get('year')) : initial.year,
      budget: text('budget'),
      exchangeDate: String(f.get('exchangeDate')),
      signupClosesAt: fromLocalInput(String(f.get('signupClosesAt'))),
      notes: text('notes'),
    })
    setBusy(false)
    if (ok && !onCancel) form.reset()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {showYear && (
          <Field label="Year" id="year">
            <Input id="year" name="year" type="number" min={2000} max={2100} required defaultValue={initial.year} />
          </Field>
        )}
        <Field label="Budget" id="budget">
          <Input id="budget" name="budget" placeholder="$50" maxLength={40} defaultValue={initial.budget ?? ''} />
        </Field>
        <Field label="Exchange date" id="exchangeDate">
          <Input id="exchangeDate" name="exchangeDate" type="date" required defaultValue={initial.exchangeDate} />
        </Field>
        <Field label="Signups close" id="signupClosesAt">
          <Input
            id="signupClosesAt"
            name="signupClosesAt"
            type="datetime-local"
            required
            defaultValue={toLocalInput(initial.signupClosesAt)}
          />
        </Field>
      </div>
      <Field label="Notes" id="notes" hint="Theme, house rules, where you’re meeting. Markdown works.">
        <Textarea id="notes" name="notes" rows={4} defaultValue={initial.notes ?? ''} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{submitLabel}</Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        )}
      </div>
    </form>
  )
}

function Field({ label, id, hint, children }: { label: string; id: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
