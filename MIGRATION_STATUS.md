# Migration Status: Supabase → Self-hosted Postgres + S3 + SMTP

**Status:** ⚠️ IN PROGRESS — the project will NOT build in this state. One more focused turn is needed to finish.

## ✅ Done

### Database
- `chroma_lab_full_schema.sql` rewritten — no Supabase dependencies, uses `app_users` table and `current_app_user()` / `current_app_is_admin()` GUC helpers in RLS policies. **Ready to run on a fresh self-hosted Postgres.**

### New server-only libraries (all under `src/`)
- `src/db/index.server.ts` — pg pool + `withDb/withUser/withAdmin` helpers that open a transaction, set `app.user_id`/`app.is_admin` GUCs (so RLS engages), and run the handler.
- `src/lib/auth/password.server.ts` — bcrypt hash/verify.
- `src/lib/auth/jwt.server.ts` — `jose`-based session JWT (HS256, 7-day TTL, `chroma_session` cookie name).
- `src/lib/auth/users.server.ts` — `createUser`, `authenticate`, `updateEmail`, `updatePassword`, `issueResetToken`, `consumeResetToken`.
- `src/lib/storage.server.ts` — S3-compatible: `createSignedUploadUrl`, `createSignedDownloadUrl`, `downloadObject`, `removeObjects`, `publicUrl`. Single bucket; legacy bucket names (`raw-runs`, `reports`, `branding`, `avatars`) used as folder prefixes.
- `src/lib/email.server.ts` — nodemailer SMTP transport + `appUrl()` helper.
- `src/lib/auth-middleware.ts` — `requireAuth` middleware that reads session cookie, validates, looks up admin flag, opens a DB transaction with GUCs set, injects `{ userId, email, isAdmin, db }` into context.
- `src/lib/auth-context.tsx` — rewritten React provider that calls `/api/auth/me` instead of Supabase.

### New API routes (server routes — TanStack file-based)
- `POST /api/auth/login`
- `POST /api/auth/signup` (also validates + consumes invite code, assigns role, signs the user in)
- `POST /api/auth/logout`
- `GET  /api/auth/me`
- `POST /api/auth/reset-request` (sends email via SMTP)
- `POST /api/auth/reset`
- `POST /api/public/bootstrap-admin` (gated by `BOOTSTRAP_TOKEN` env var — for creating the first admin on a fresh install)

### Packages
- Added: `pg`, `bcryptjs`, `jose`, `nodemailer`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (+ types).
- Removed: `@supabase/supabase-js`.

---

## ❌ Not done yet (needs one more turn)

### 1. Rewrite server functions to use the new `db` context
These files still import from `@/integrations/supabase/*` and won't compile:
- `src/lib/lab.functions.ts` — ~1000 lines, ~25 server functions. Each `supabase.from(...).select/insert/update/delete/upsert(...)` call needs to be ported to raw SQL using `context.db` from the new `requireAuth` middleware. Storage calls (`supabase.storage.from("raw-runs").download/createSignedUploadUrl/remove`) need to be swapped for `downloadObject` / `createSignedUploadUrl` / `removeObjects` from `src/lib/storage.server.ts`.
- `src/lib/lab-data.server.ts` — mappers stay the same; `fetchAllForUser`, `getCurrentUserProfile`, `listAllUsersAdmin`, `setUserRoleAdmin` need to use `withUser`/`withAdmin` and raw SQL.
- `src/lib/account.functions.ts` — `getMyAccount`, `updateMyProfile`, `updateMyEmail`, `updateMyPassword` need to use the new auth/users layer.
- `src/lib/branding.functions.ts` — `getBranding`, `setBranding`, invite-code CRUD. Note `consumeInviteCode` is now handled inside `/api/auth/signup` — that exported fn should be removed and `signup.tsx` refactored to call the API directly instead of `validateInviteCode`/`consumeInviteCode` server fns (these can stay if you want validation UX on the form).

### 2. Rewrite client routes
- `src/routes/login.tsx` — replace `sb.auth.signInWithPassword(...)` with `fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })`, then `refresh()` from `useAuth`.
- `src/routes/signup.tsx` — replace Supabase signup with a single `fetch('/api/auth/signup', ...)` call (invite code is validated server-side inside that endpoint already).
- `src/routes/reset-password.tsx` — replace hash-fragment recovery with `?token=` query param; POST to `/api/auth/reset-request` and `/api/auth/reset`.
- `src/routes/_shell.runs.index.tsx` — only the file-upload path: remove `getSupabase()` + `sb.storage.from("raw-runs").uploadToSignedUrl(...)`, switch to plain `fetch(signedUrl, { method: 'PUT', body: file })` (the same pattern `_shell.account.tsx` already uses for avatar upload).

### 3. Delete old Supabase files
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/client.server.ts`
- `src/integrations/supabase/auth-fetch.ts`
- `src/integrations/supabase/auth-middleware.ts`
- `src/routes/api/public/config.ts` (no longer needed — nothing client-side needs runtime config)

### 4. Update deployment
- `Dockerfile` — no change strictly required, but document the new env-var requirements.
- `docker-compose.yml` — swap the `LAB_SUPABASE_*` / `SUPABASE_*` env vars for the new set (see below).

---

## Env vars (final list, to set in Easypanel)

```
NODE_ENV=production
HOST=0.0.0.0
PORT=29473
ALLOWED_HOSTS=<your.domain.com>           # or "all" behind a trusted proxy
APP_URL=https://<your.domain.com>         # used in password-reset email links

# Postgres (your Plesk-hosted instance)
DATABASE_URL=postgres://user:pass@host:5432/dbname
DATABASE_SSL=true                          # set to "true" if your Postgres requires TLS
DATABASE_POOL_MAX=10

# Auth
JWT_SECRET=<openssl rand -hex 32>
BOOTSTRAP_TOKEN=<random string; clear after creating first admin>

# S3-compatible storage (single bucket; folder prefixes per legacy bucket name)
S3_ENDPOINT=https://<your-s3-endpoint>     # leave unset for AWS S3
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=chroma-lab
S3_PUBLIC_URL_BASE=https://<cdn-or-public-endpoint>/chroma-lab   # optional; used for branding + avatars

# SMTP
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM="CHROMA.LAB <no-reply@example.com>"
```

---

## How to finish

In the next turn, ask me to "**finish the Supabase → Postgres migration**" and I'll do steps 1–4 above in one go. It's a large mechanical rewrite of ~5 files but follows clear patterns now that all the new infrastructure is in place.

Make sure your S3 bucket has CORS configured to allow `PUT` from your app's origin — the browser uploads directly to S3 via presigned URLs.
