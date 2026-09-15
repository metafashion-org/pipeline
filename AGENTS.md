# AGENTS.md

Instructions for AI coding agents working in this repo. `CLAUDE.md` imports this file, so Claude Code and other agents read the same rules. Read this file first, then the guide that matches the task.

## Platform

| Layer | Technology | Where it's configured |
|---|---|---|
| App | Next.js 16 App Router, React 19, TypeScript | `web/` |
| Database | Postgres on Supabase, accessed through Drizzle ORM | `web/lib/db/`, `web/drizzle/`, `.mcp.json` |
| Sign-in | Google OAuth through NextAuth | `web/app/api/auth/[...nextauth]/route.ts` |
| Authorization | `personnel` table rows (roles, status, capability overrides), resolved in `web/lib/auth/rbac.ts` | `web/lib/auth/` |
| Hosting | Vercel, region `bom1` (Mumbai), with a daily cron at 06:00 UTC for `/api/admin/payment-cycles/run` | `web/vercel.json` |
| UI | shadcn/ui, Tailwind CSS v4, SWR | `web/components/` |
| CI | GitHub Actions: build, deadcode, typecheck, tests, React Doctor | `.github/workflows/` |

The app tracks Roblox UGC catalog items ("assets") from curation through artist assignment, review, Roblox upload and payment. `README.md` describes the roles, routes and feature areas in full.

A Google sign-in only creates a session. What the person can open comes from their `personnel` row, and anyone whose `status` is not `Active` is denied on every page and API route.

## Guides

| Task | Read |
|---|---|
| Writing or reviewing any code | `guides/code-review.md` |
| Finding which tables exist and how they connect | `guides/erd.md` |
| Querying, writing, migrating or testing against the database | `guides/database.md` |

The guides live in `guides/` because `.gitignore` excludes every folder named `docs/`.

## Commands

Run these from `web/`.

```bash
pnpm dev            # dev server on localhost:3000
pnpm typecheck      # tsc --noEmit (CI gate)
pnpm lint           # eslint
pnpm deadcode       # knip: unused files and dependencies (CI gate)
pnpm test:db:up     # local Postgres on port 5433, migrated and seeded
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/metafashion_test pnpm test
pnpm test:db:down   # remove the container and its volume
```

Set `DATABASE_URL` to the local database every time you run `pnpm test`. The test runner has no localhost guard, and when the variable is unset `lib/db/client.ts` reads `web/.env.local`, which holds the Supabase production connection string.

Before reporting work finished, run `pnpm typecheck`, `pnpm lint`, `pnpm deadcode` and the tests that cover the changed files. The pre-commit hook runs `pnpm deadcode` and `pnpm build` on any commit that touches `web/`.

## Where code goes

| Kind of code | Location |
|---|---|
| Business logic and database queries | `web/lib/<area>/<area>-service.ts` |
| HTTP handlers | `web/app/api/**/route.ts`, limited to auth, input parsing, service calls, cache invalidation and the response |
| Pages | `web/app/(shell)/**/page.tsx` |
| Feature components | `web/components/<area>/` |
| UI primitives | `web/components/ui/`, added with the shadcn CLI and not edited by hand |
| Unit and integration tests | `__tests__/<name>.test.ts` beside the code under test |
| End-to-end tests | `web/tests/*.spec.ts` (Playwright) |
| Table definitions | `web/lib/db/schema/<table>.ts`, one file per table |
| Migrations | `web/drizzle/00NN_<name>.sql`, written by hand as described in `guides/database.md` |

## Rules

1. Every API route calls `getAuthedUser()` from `lib/auth/authed-user.ts` and checks `user.caps`. `proxy.ts` guards page routes only and never runs for `/api`.
2. Use the shared utilities listed in `guides/code-review.md` instead of writing a local version.
3. Give every number or string that carries meaning a named constant, with the unit in the name (`PERSONNEL_CACHE_MS`).
4. Never run migrations, seeds, `drizzle-kit push` or data-changing scripts against the Supabase production database unless the user asks for it in the current conversation. The Supabase MCP server in `.mcp.json` is connected to the production project.
5. Merging to `main` deploys to Vercel but does not migrate Supabase. A PR that adds a file under `web/drizzle/` says so in its description.
6. Change an asset's status only through `updateAssetStatusInKanban()` in `lib/kanban/kanban-service.ts`, which enforces `status_transition_rules` and artist ownership.
7. After a write that changes a cached view, call `revalidateViews(CACHE_TAGS.<tag>)` from `lib/cache/tags.ts`.
8. Validate request bodies with a Zod schema and `safeParse`, and return 400 when parsing fails.
9. Read environment variables through `ENV` from `lib/env.ts`. A new variable is added to its Zod schema and to the Vercel project settings. Modules that tests import read `process.env` instead, because `lib/env.ts` throws when the NextAuth variables are missing, and CI doesn't set them.
10. Tests run against a real Postgres database. Don't mock the database.

## Comments

- When you add or change a line whose purpose isn't clear from the code alone, put a comment directly above it saying what the line does and why it's needed. Use `//` in TypeScript, `#` in shell, YAML and `.env` files, and `--` in SQL.
- Comment the things a reader can't see in the code: where a constant's value comes from, the failure a guard prevents, a limit of an external API, or the reason a simpler version breaks.
- A comment describes the code as it now stands. The history of the change goes in the commit title and the PR description.
- When you change code, update or delete the comments on it in the same change.
- Exported functions whose inputs or outputs aren't clear from the signature get a docstring with `Input:` and `Output:`, as in `web/lib/format-date.ts`.

## Git

- GitButler manages this checkout, and its pre-commit hook blocks `git commit` on `gitbutler/workspace`.
- Create a branch with `but branch new <name>`, commit with `but commit`, push with `but push`, and update from `main` with `but pull`.
- Commit titles are short imperative sentences, for example "Add brand group filter to the board".
- CI (`.github/workflows/build.yml`) runs build, deadcode, typecheck and tests on every PR to `main`. `react-doctor.yml` posts advisory React findings on each PR.
