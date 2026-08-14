# MetaFashion Kanban

Task management board for MetaFashion — admin assigns work to artists, tracks status across a Kanban pipeline, and views analytics on throughput.

## Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Database**: Supabase (Postgres + Auth + Storage)
- **UI**: shadcn/ui + Tailwind CSS
- **Email**: Resend
- **Auth**: Google OAuth only

## Setup

```bash
cp .env.example .env.local   # fill in all values
pnpm install
pnpm dev
```

## Environment Variables

See [.env.example](.env.example) for the full list. Key ones:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable / anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth Client ID for NextAuth |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth Client Secret for NextAuth |
| `NEXTAUTH_SECRET` | Secret key for NextAuth JWT encoding |


### Access Control

Access is controlled entirely via `ADMIN_EMAILS` and `ARTIST_EMAILS` environment variables. When a user signs in with Google OAuth:

1. Middleware checks their email against both lists
2. If found in `ADMIN_EMAILS` → routes to `/admin` (full Kanban, all tasks)
3. If found in `ARTIST_EMAILS` → routes to `/artist` (own tasks only)
4. If not found in either → redirected to `/unauthorized`

**To add a new user**: add their email to the appropriate env var and redeploy.

### Migrating Off Env Vars (Future)

If managing env vars becomes a pain (e.g. frequent artist additions), migration is trivial:

1. Create an `allowed_emails` table:
   ```sql
   CREATE TABLE allowed_emails (
       id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       email TEXT UNIQUE NOT NULL,
       role  TEXT NOT NULL CHECK (role IN ('admin', 'artist'))
   );
   ```
2. Update `proxy.ts` middleware to query this table instead of parsing env vars
3. Build an admin UI to manage the list (add/remove emails)
4. **Nothing else changes** — `tasks.assigned_to` still stores emails, auth still uses Google OAuth, RLS stays the same

## Architecture

### Database (3 tables)

- **`tasks`** — core entity (title, description, status, assigned_to, feedback_text, reference_images)
- **`status_transitions`** — every status change is logged with timestamp and who did it (drives all analytics)
- **`reference_images`** — uploaded images attached to tasks, stored in Supabase Storage

### Kanban Pipeline

```
Admin view (7 columns):
To Be Assigned → Assigned → In Process → Received for Review →
Approved & Ready → Payment Made → Done

Artist view (5 columns):
Assigned → In Process → Submitted for Review →
Feedback Received → Approved
```

### Email Notifications

Sent via Resend on: task assignment, feedback sent, submission received, payment made.
