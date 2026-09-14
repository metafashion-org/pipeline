# MetaFashion Pipeline — `web/`

The Next.js app. For the full picture (domain model, roles, feature areas, integrations), see the
[repo root README](../README.md) — this file only covers running this package.

## Setup

```bash
pnpm install
# create .env.local with the vars listed in the root README's "Environment variables" table
# (no .env.example is committed)
pnpm dev
```

Auth is Google OAuth (NextAuth) + a `personnel` table for authorization (roles, status,
per-person capability overrides) — not env-var email lists. `ADMIN_EMAILS`/`ARTIST_EMAILS` still
exist in `lib/env.ts` for backward compatibility but no longer gate access on their own.

## Common commands

```bash
pnpm dev             # dev server
pnpm build / start   # production build/serve
pnpm db:migrate      # apply Drizzle migrations
pnpm db:seed         # seed pipeline statuses
pnpm typecheck
pnpm lint
pnpm test            # unit/integration tests (needs pnpm test:db:up first — see root README)
pnpm test:e2e        # Playwright
```

See the root README's **Development**, **Tests**, and **Environment variables** sections for
details.
