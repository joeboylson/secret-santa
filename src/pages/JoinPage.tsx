import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Layout } from '@/components/Layout'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

export default function JoinPage() {
  const { code = '' } = useParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // StrictMode runs effects twice in dev; only join once.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    supabase.rpc('join_group', { code }).then(({ data, error }) => {
      if (error) setError(errorMessage(error))
      else navigate(`/g/${data}`, { replace: true })
    })
  }, [code, navigate])

  return (
    <Layout>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Couldn’t join</AlertTitle>
          <AlertDescription>
            {error} Ask your organizer for a fresh link. <Link to="/" className="underline">Go home</Link>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">Joining…</p>
      )}
    </Layout>
  )
}
