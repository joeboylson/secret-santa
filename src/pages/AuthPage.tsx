import { useState, type FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { Layout } from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'

export default function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const next = params.get('next') ?? '/'
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to={next} replace />

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email'))
    const password = String(form.get('password'))
    setBusy(true)
    const { error } =
      mode === 'login'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({
            email,
            password,
            options: { data: { display_name: String(form.get('name')) } },
          })
    setBusy(false)
    if (error) toast.error(errorMessage(error))
  }

  const other = mode === 'login' ? '/signup' : '/login'

  return (
    <Layout>
      <Card>
        <CardHeader>
          <CardTitle>{mode === 'login' ? 'Sign in' : 'Create an account'}</CardTitle>
          <CardDescription>
            {mode === 'login' ? 'Welcome back.' : 'You’ll need an invite link from your group to join it.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            {mode === 'signup' && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" name="name" required maxLength={60} autoComplete="name" />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
            <Button type="submit" disabled={busy}>
              {mode === 'login' ? 'Sign in' : 'Sign up'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              {mode === 'login' ? 'No account yet? ' : 'Already have an account? '}
              <Link to={`${other}?next=${encodeURIComponent(next)}`} className="underline">
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </Layout>
  )
}
