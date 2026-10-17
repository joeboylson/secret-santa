import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'

export function Layout({ children }: { children: ReactNode }) {
  const { session } = useAuth()

  return (
    <div className="mx-auto flex min-h-svh max-w-2xl flex-col gap-6 px-4 py-6">
      <header className="flex items-center justify-between">
        <Link to="/" className="font-heading text-lg font-semibold">
          Secret Santa
        </Link>
        {session && (
          <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </Button>
        )}
      </header>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  )
}
