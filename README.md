# Secret Santa

Yearly Secret Santa for groups. See [PLAN.md](PLAN.md) for the design.

## Local setup

```sh
npm install
supabase start                 # local Supabase on ports 544xx
cp .env.example .env.local     # fill VITE_SUPABASE_ANON_KEY from `supabase status`
npm run dev
```

Studio: http://127.0.0.1:54423

Running next to another local Supabase project? Docker's default 4 GB isn't
enough for two stacks, and queries start timing out. Either give Docker more
memory, or skip the extras: `supabase start -x studio,edge-runtime,postgres-meta,mailpit`.

## Scripts

- `npm run db:types` — regenerate `src/lib/database.types.ts` after a migration
- `npm run test:db` — end-to-end check of the draw and privacy rules against local Supabase.
  Needs `SUPABASE_ANON_KEY` (and optionally `SUPABASE_SERVICE_ROLE_KEY`) from `supabase status -o env`.

## Privacy

Pairings are encrypted with a key in Supabase Vault (`secret_santa_key`). The
table editor shows only ciphertext. Do not delete or rotate that secret while an
event is active, or every pairing becomes unreadable.
