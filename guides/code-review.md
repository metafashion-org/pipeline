# Code review and coding rules

These rules apply to writing code and to reviewing it. An agent writing code checks its own diff against them before finishing. A reviewer reports each broken rule as a finding.

## How to review

1. Read the full diff: `git diff origin/main -- web`.
2. Read every changed function in full, and read its callers, before judging it.
3. From `web/`, run `pnpm typecheck`, `pnpm lint`, `pnpm deadcode` and the tests for the changed areas (see `guides/database.md` for the test database).
4. Run the grep checklist at the end of this file over the changed files.
5. Report each finding as `file:line`, the rule it breaks, and the change that fixes it.
6. Order findings by impact: authorization holes and data loss first, then wrong behavior, then rule breaks that don't change behavior.

Older code breaks some of these rules. A change is not blocked for problems it didn't add. A change that adds a new copy of a forbidden pattern is flagged, and old copies are fixed only on lines the change already touches.

## 1. Use the shared utilities

Before writing a helper, search `web/lib/` for an existing one. When two places need the same logic and no helper exists, add one under `web/lib/` and use it in both.

| Need | Use | Don't write |
|---|---|---|
| Call this app's API from a client component | `apiCall(url, { method, body })` from `lib/api-client.ts`, which returns `{ ok, status, data }` and never throws | `fetch()` then `res.json()` then an `ok` check, because `res.json()` throws on an HTML error page before the check runs |
| Load JSON with SWR | `jsonFetcher` from `lib/fetcher.ts` | An inline fetcher passed to `useSWR`, or `useEffect` with `fetch` |
| Read a message from a caught error | `errorMessage(error, "fallback")` from `lib/errors.ts` | `error instanceof Error ? error.message : "fallback"` |
| Find the caller in an API route | `getAuthedUser()` from `lib/auth/authed-user.ts` | `getServerSession()`, which doesn't check `personnel.status` |
| Decide what a caller may do | `user.caps`, or `getEffectiveCapabilities()` and `isRouteAllowedForRoles()` from `lib/auth/rbac.ts` | Role-name checks such as `roles.includes("admin")` or `session.user.role` |
| Refresh a person's auth after changing their roles or status | `invalidatePersonnelAuthCache()` from `lib/auth/personnel-auth.ts` | Nothing, which leaves the old roles active for up to 60 seconds |
| Show a date | `formatDate()` or `formatDateTime()` from `lib/format-date.ts` (locale `en-GB`, timezone `Asia/Kolkata`) | `toLocaleDateString()` without arguments, which renders differently on server and browser and causes a hydration mismatch |
| Show a fee or amount | `formatFee(amount, currency, emptyText)` and `CURRENCY_SYMBOLS` from `lib/format-money.ts` | A local symbol map or `toLocaleString` on an amount |
| Read an environment variable | `ENV` from `lib/env.ts`, after adding the variable to its Zod schema | `process.env.X` in feature code |
| Cache a page's data loader | `cachedView(loader, keyParts, tags)` from `lib/cache/tags.ts` | `unstable_cache` directly |
| Invalidate cached views after a write | `revalidateViews(CACHE_TAGS.x)` from `lib/cache/tags.ts` | `revalidateTag` directly, or a tag string missing from `CACHE_TAGS` |
| Query the database | `db` from `lib/db/client.ts` and the table from `lib/db/schema/<table>.ts` | A new `postgres()` connection |
| Open a separate database connection in a script | `parseConnectionPassword()` from `lib/db/connection.ts` for the password override | Passing the connection string to `postgres()` alone, which fails on a password containing `@` |
| Change an asset's status | `updateAssetStatusInKanban()` from `lib/kanban/kanban-service.ts`, catching `TransitionRefusedError` (from `lib/kanban/transition-errors.ts`) and answering with its `httpStatus` | `db.update(assets).set({ currentStatus })` |
| Combine Tailwind classes | `cn()` from `lib/utils.ts` | Template strings or `+` on class names |
| Buttons, dialogs, selects, tables, sheets, tabs | `components/ui/*` | A new hand-styled primitive |

Accepted exceptions:

- `apiCall` sends JSON only. A multipart upload such as `components/kanban/reference-upload-button.tsx` calls `fetch` directly.
- `lib/env.ts` validates the NextAuth and Google OAuth variables when imported and throws if they're missing. The CI test job doesn't set them. Modules that tests import (`lib/discord/discord-service.ts`, and `lib/db/client.ts` through every DB test) therefore read `process.env` directly. `lib/assets/drive-upload.ts` does the same for `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHARED_DRIVE_ID`.

## 2. No magic numbers or strings

A magic value is a literal whose meaning isn't stated where it's used, such as `60000`, `5`, `"payment_done"` or `/forbidden|not permitted/`.

- Give each one a named `const` at the top of the module. When more than one file uses it, export it from a shared module.
- Put the unit in the name: `PERSONNEL_CACHE_MS = 60_000`, `DEFAULT_REVALIDATE_SECONDS = 300`.
- Write large numbers with separators (`60_000`) or as arithmetic that shows the unit (`7 * 24 * 60 * 60 * 1000`).
- Keep a set of related values in one exported array or object with `as const` and derive the type from it, as `CACHE_TAGS` in `lib/cache/tags.ts` and `FORM_AUDIENCES` in `lib/db/schema/form_definitions.ts` do.
- Status keys and other values the database stores as text are compared against a named constant. The same string literal must not be typed out in several files.
- Don't pick behavior by matching error message text, because rewording a message then changes behavior. Throw a typed error class and branch with `instanceof`, as `app/api/assets/[skuId]/status/route.ts` does with `TransitionRefusedError`.

Allowed literals: `0`, `1`, `-1`, array indexes, HTTP status codes passed to `NextResponse.json`, CSS and Tailwind values, and fixture data inside tests.

Examples to copy: `PERSONNEL_CACHE_MS` and `PERSONNEL_CACHE_MAX_ENTRIES` in `lib/auth/personnel-auth.ts`, `PAYMENT_GATED_STATUSES` in `lib/kanban/kanban-service.ts`, `CACHE_TAGS` in `lib/cache/tags.ts`, `DEFAULT_CURRENCY` in `lib/format-money.ts`.

## 3. No magic functions

A magic function does something that its name and signature don't show: it writes to the database, sends an email, reads global state, or changes behavior based on the shape of its input. The reader has to open it to find out.

- The name states what the function does, side effects included. A function that saves an asset and queues an email is named `saveAssetAndQueueEmail`, not `processAsset`.
- Inputs arrive as parameters. A function reads `process.env`, the session or module-level mutable state only when its name says so, as `getAuthedUser()` does.
- A boolean parameter that switches between two behaviors becomes two functions, or an options object with a named field.
- Code doesn't run at import time. Connecting, reading files and registering handlers happen inside a function the caller invokes. `lib/db/client.ts` and `lib/env.ts` are the two accepted exceptions.
- One function does one job. A route handler that validates input, queries three tables, builds an email and clears a cache is split into one service function per job.
- The return type is explicit and has the same shape on every branch. `any` is not a return type.
- Errors are not swallowed. A script that catches a failure exits with a non-zero code, as `lib/db/run-migrate.ts` and `lib/db/run-migrations.ts` do, so the caller doesn't see success.
- Calls are direct. No `handlers[name]()` keyed by request input, no `eval`, no computed `import()`.
- An exported function whose inputs or outputs aren't clear from its signature has a docstring stating them, in the style of `lib/format-date.ts`.

## 4. Authorization

- Every handler in `app/api/**/route.ts` calls `getAuthedUser()` first and returns 401 when it returns null.
- The handler checks `user.caps.<capability>` and returns 403 when the capability is false.
- A route that is public on purpose says so in a comment at the top of the file, as `app/api/health/db/route.ts` does.
- A cron route checks its secret header before doing any work.
- A service function that acts for a user takes the actor (`{ roles, personnelId }`) as a parameter and enforces ownership itself, as `updateAssetStatusInKanban()` does for artists.
- Responses never contain database error text. `app/api/health/db/route.ts` logs the error and returns `{ ok: false }`.
- A change to route access adds a case to `lib/auth/__tests__/rbac.test.ts`.

## 5. Database

- Queries live in `lib/<area>/` service files. Route handlers call services.
- Use the Drizzle query builder with `eq`, `and` and `inArray` from `drizzle-orm`. Raw SQL goes through the `sql` tagged template, which parameterizes values. SQL is never built by joining strings.
- A write that changes more than one table runs inside `db.transaction`. No code does this yet, so a failure halfway through any existing multi-step write leaves partial data.
- An admin change to personnel, assets or configuration inserts an `audit_log` row with `action`, `entityType`, `entityId`, `actorId` and `payload`.
- Schema changes follow `guides/database.md`.

## 6. React

- Client components load data with SWR and `jsonFetcher`, not `useEffect` with `fetch`.
- Values that can be computed from props or state are computed during render, not copied into state from an effect.
- Pages stay dynamic. Only the database work behind a page is cached, through `cachedView`.
- React Doctor posts findings on every PR. New findings it reports on changed lines count as review findings.

## 7. Tests

- Tests use `node:assert` and run under `tsx --test` against a real database. There is no mocking library.
- Test rows use keys that identify them (`TEST-ARCHIVE-PAID-SETTLED`). Delete them before the test runs and again in `finally`.
- Assert behavior through the service function. Reading a source file as text and asserting on substrings is not a test; `app/(shell)/admin/archive/__tests__/archive.test.ts` records why that approach was removed.
- A bug fix adds a test that fails without the fix.

## 8. Comments

- A comment states what the code does, or a fact the code can't show, such as a limit or the reason a simpler version breaks.
- Comments don't record task IDs, session history or who found a bug. That goes in the commit or PR.

## Grep checklist

Run from `web/`. Each hit is a line to read and judge against the rules above.

```bash
CHANGED=$(git diff --name-only --relative --diff-filter=d origin/main -- . | grep -E '\.(ts|tsx)$')
grep -n  'fetch('                          $CHANGED  # client code uses apiCall or jsonFetcher
grep -n  'instanceof Error ?'              $CHANGED  # use errorMessage
grep -n  'getServerSession'                $CHANGED  # API routes use getAuthedUser
grep -n  'roles\.includes\|\.role ==='     $CHANGED  # check capabilities
grep -n  'toLocaleDateString\|toLocaleString' $CHANGED  # use formatDate, formatDateTime or formatFee
grep -n  'process\.env\.'                  $CHANGED  # use ENV from lib/env.ts
grep -n  'revalidateTag\|unstable_cache'   $CHANGED  # use revalidateViews or cachedView
grep -n  'currentStatus'                   $CHANGED  # status writes go through updateAssetStatusInKanban
grep -nE '[^0-9A-Za-z_.#-][0-9]{3,}'       $CHANGED  # unnamed numbers of 3 or more digits
grep -nE '\.test\((message|err)|message\.includes' $CHANGED  # branching on error text
grep -n  ': any\|as any'                   $CHANGED  # untyped values
grep -nE 'catch *(\([^)]*\))? *\{ *\}'     $CHANGED  # empty catch blocks
grep -n  'sql`'                            $CHANGED  # confirm every value is interpolated, not concatenated
```
