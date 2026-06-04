## Goal

Remove the dependency on Supabase entirely. Keep Postgres (self-hosted on your Plesk server), keep RLS, replace Supabase Auth with a self-contained JWT-based auth service, and replace Supabase Storage with any S3-compatible bucket. Email goes through SMTP credentials you'll provide.

## What you set up (one-time, before code work)

You handle these; I'll provide exact SQL/configs:

1. **Postgres** on Plesk: create a database + a Postgres user, give me the connection string (`postgres://user:pass@host:5432/dbname`).
2. **S3-compatible bucket**: create one bucket (we'll use folder prefixes for the four existing logical buckets). Provide endpoint URL, region, access key, secret key, bucket name.
3. **SMTP**: provide host, port, user, password, "from" address.

## High-level architecture after migration

```text
Browser ──► TanStack server fn (in container)
              │
              ├─► pg (Postgres on Plesk) ── RLS reads app.user_id GUC
              ├─► @aws-sdk/client-s3 ──► your S3-compatible bucket
              ├─► nodemailer ──► your SMTP
              └─► jose (JWT sign/verify) + bcrypt (password hashing)
```

No Supabase libraries remain. The app is fully self-contained.

## Migration steps (what I'll build)

### 1. Database layer
- Port `chroma_lab_full_schema.sql` to a Supabase-free version:
  - Remove references to `auth.users` and `auth.uid()`.
  - Create our own `app.users` table (id, email, password_hash, email_verified_at, created_at).
  - Rewrite `has_role()` and every RLS policy to read `current_setting('app.user_id', true)::uuid` instead of `auth.uid()`.
  - Drop Supabase Storage bucket policies (storage is now external).
  - Keep all domain tables, enums, triggers, and audit logic unchanged.
- Produce a single bootstrap SQL file you run once on the new Postgres.

### 2. Auth service (replaces Supabase Auth)
- `src/lib/auth/` module: `signup`, `login`, `logout`, `requestPasswordReset`, `resetPassword`, `verifyEmail`, `getCurrentUser`.
- Passwords hashed with `bcrypt`. Sessions are JWTs signed with `jose` (HS256, 7-day expiry, refresh on use).
- Session token stored in an `httpOnly`, `secure`, `sameSite=lax` cookie.
- Password reset + email verification send links via SMTP (nodemailer).
- Replace `src/integrations/supabase/auth-middleware.ts` with a `requireAuth` middleware that:
  1. Reads the JWT from cookie.
  2. Verifies it.
  3. Opens a pooled pg client, runs `SET LOCAL app.user_id = $userId` inside a transaction.
  4. Injects `{ db, userId }` into server-fn context.
- Replace `src/lib/auth-context.tsx` to call `/api/auth/*` server routes for login/signup/logout instead of `supabase.auth.*`. `onAuthStateChange` becomes a simple React context fed by a `getMe` server fn.

### 3. Database access layer (replaces `@supabase/supabase-js` queries)
- Add `pg` + `kysely` (typed query builder, no codegen runtime).
- New `src/db/index.ts`: pooled `pg.Pool`, helper `withUser(userId, fn)` that opens a transaction and sets the GUC so RLS engages.
- Rewrite every `*.functions.ts` and `*.server.ts` file (~15 files) to use Kysely queries. Same RPC shape — only the internals change. Components don't change.

### 4. Storage layer (replaces Supabase Storage)
- New `src/lib/storage/` module with the same shape Supabase exposed: `upload`, `download`, `getSignedUrl`, `getPublicUrl`, `remove`.
- Uses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`. Endpoint, region, keys read from env.
- Folder layout in the single bucket: `raw-runs/<userId>/...`, `reports/<userId>/...`, `branding/<orgId>/...`, `avatars/<userId>/...`.
- Replace all `supabase.storage.from(...)` calls (avatars, branding, run mzML uploads, generated PDFs) with the new module.

### 5. Email
- `src/lib/email.ts`: nodemailer transport from `SMTP_HOST/PORT/USER/PASS/FROM`.
- Used by password reset + email verification. Templates inline (no fancy MJML — plain HTML).

### 6. Remove Supabase
- Delete `src/integrations/supabase/` entirely.
- Remove `@supabase/supabase-js` from `package.json`.
- Delete `src/routes/api/public/config.ts` (no longer needed; nothing client-side needs runtime config).
- Update `Dockerfile`/`docker-compose.yml` env vars.

### 7. Deployment
- New required env vars in Easypanel:
  - `DATABASE_URL` — Postgres connection string
  - `JWT_SECRET` — 32+ random bytes
  - `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_PUBLIC_URL_BASE` (optional, for public assets via CDN)
  - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`
  - `APP_URL` — used in password reset email links
- Removed env vars: all `LAB_SUPABASE_*` and `SUPABASE_*`.
- Updated `docker-compose.yml` reflects the new set with sane `${VAR:-}` defaults.

## Order of operations (what you'll see)

1. I deliver the new bootstrap SQL → **you run it on your Plesk Postgres**.
2. I refactor auth + db + storage layers + rewrite all server fns. App should build clean.
3. I update `Dockerfile`/`docker-compose.yml` + give you the final env-var list for Easypanel.
4. You set env vars in Easypanel and redeploy.
5. First admin user: I'll add a one-time `/api/public/bootstrap-admin` route gated by a `BOOTSTRAP_TOKEN` env var so you can create the first developer account, then remove the route.

## Risks / things to know

- **No data migration included.** This builds a fresh empty database. If you have existing data in your current Supabase instance, that's a separate one-time export/import task — call it out and I'll add it.
- **Realtime is gone.** The app doesn't currently use Supabase realtime subscriptions, so no impact — flagging in case future features need it.
- **Lovable's managed email/queue infra and `email_domain--*` tools are Supabase-bound** and won't work post-migration. SMTP via nodemailer takes their place; you're responsible for SPF/DKIM on the sending domain.
- **Scope is large.** Touches ~20 files plus full schema rewrite. Expect a sizable diff. Component code mostly doesn't change.

## Technical details

- **JWT lib**: `jose` (Worker-compatible, used in TanStack's Cloudflare/edge runtime — no Node crypto issues).
- **Password hashing**: `bcryptjs` (pure JS — `bcrypt` native bindings won't run in the Worker runtime per the server-runtime constraints).
- **DB driver**: `pg` + `kysely`. Pool created once at module scope in a `*.server.ts` file (server-only).
- **RLS pattern**: every server-fn handler runs queries inside `db.transaction().execute(async (trx) => { await sql\`set local app.user_id = ${userId}\`.execute(trx); /* queries */ })`. RLS policies use `current_setting('app.user_id', true)::uuid` in place of `auth.uid()`.
- **Service-role equivalent**: a small `dbAdmin` helper that opens a connection without setting the GUC. RLS policies include `... OR current_setting('app.is_admin', true) = 'true'` rows where needed, and admin code runs `set local app.is_admin = 'true'`.
- **File uploads**: client uploads via presigned PUT URLs (server fn returns the URL, browser PUTs directly to S3). Matches current Supabase Storage UX, keeps large mzML files off the app server.
