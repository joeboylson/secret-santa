import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Layout } from '@/components/Layout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'

type Group = { id: string; name: string }

export default function HomePage() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<Group[] | null>(null)

  useEffect(() => {
    supabase
      .from('groups')
      .select('id, name')
      .order('created_at')
      .then(({ data, error }) => {
        if (error) toast.error(errorMessage(error))
        setGroups(data ?? [])
      })
  }, [])

  async function createGroup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const name = String(new FormData(e.currentTarget).get('name'))
    const { data, error } = await supabase.rpc('create_group', { group_name: name })
    if (error) return toast.error(errorMessage(error))
    navigate(`/g/${data}`)
  }

  return (
    <Layout>
      <Card>
        <CardHeader>
          <CardTitle>Your groups</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {groups?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              You’re not in any groups yet. Open an invite link, or start your own below.
            </p>
          )}
          {groups?.map((g) => (
            <Link key={g.id} to={`/g/${g.id}`} className="rounded-md px-2 py-1.5 hover:bg-muted">
              {g.name}
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Start a group</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={createGroup} className="flex gap-2">
            <Input name="name" placeholder="The Boylson family" required maxLength={80} />
            <Button type="submit">Create</Button>
          </form>
        </CardContent>
      </Card>
    </Layout>
  )
}
