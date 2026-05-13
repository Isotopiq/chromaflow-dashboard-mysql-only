
# Phase 2 — Real backend on your Supabase

Goal: replace the in-memory Zustand mocks with a real Supabase backend (your instance), add email/password + Google auth, three roles (admin / developer / reviewer) with RLS, and a Web Worker mzML parser that persists `RunSummary` + raw file to Storage.

---

## What I need from you

### 1. Credentials (I'll request via the secrets tool when you approve)
Runtime secrets to add to this project:
- `SUPABASE_URL` — your project URL (e.g. `https://xxxx.supabase.co`)
- `SUPABASE_PUBLISHABLE_KEY` — anon/publishable key
- `SUPABASE_SERVICE_ROLE_KEY` — service role key (server-only, never exposed to browser)

Also build-time/client mirrors (same values, different names):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_PROJECT_ID`

### 2. SQL to run in your Supabase SQL editor
A single migration script I'll hand you containing:
- `app_role` enum (`admin`, `developer`, `reviewer`)
- `user_roles` table + `has_role(uuid, app_role)` SECURITY DEFINER function
- `profiles` table + auto-create trigger on `auth.users` insert
- Domain tables: `columns`, `column_events`, `methods`, `method_revisions`, `batches`, `runs`, `peaks`, `analytes`, `annotations`, `reports`
- RLS enabled on every table with policies:
  - developer: full CRUD on own rows
  - reviewer: read-all + insert annotations only
  - admin: full access via `has_role(auth.uid(), 'admin')`
- Storage bucket `raw-runs` (private) with RLS by uploader
- Seed inserts for the analyte library

### 3. Supabase dashboard config (you do this)
- Authentication → Providers → enable Email, enable Google (paste OAuth client/secret)
- Authentication → URL Configuration → add this project's preview + published URLs to redirect allowlist
- Storage → confirm `raw-runs` bucket created by the SQL

---

## What I'll build

### A. Supabase client wiring
- `src/integrations/supabase/client.ts` — browser client (publishable key, session persistence)
- `src/integrations/supabase/client.server.ts` — admin client (service role, server-only)
- `src/integrations/supabase/auth-middleware.ts` — `requireSupabaseAuth` for server fns
- Generated `database.types.ts` from the schema

### B. Auth UI + guards
- `/login`, `/signup`, `/reset-password`, `/auth/callback` (Google OAuth)
- Move all current `_shell.*` routes under `_authenticated/_shell.*` — TanStack pathless layout with `beforeLoad` redirect to `/login`
- Admin-only sub-layout `_authenticated/_admin/` for `/admin`
- Topbar user menu: real session, sign-out, role badge

### C. Server functions (`src/lib/*.functions.ts`)
- `methods`: list / get / upsert / compare / revisions
- `columns`: list / get / upsert / logEvent
- `runs`: list / get / createFromUpload(summary, fileRef) / annotatePeak
- `batches`: list / linkRun
- `analytes`: list / suggestMatches(peaks)
- `admin`: listUsers / setRole (admin-gated via `has_role`)
- All protected with `requireSupabaseAuth`; admin ones additionally check role

### D. Replace Zustand reads with TanStack Query
- Each page swaps `useLab()` for `useQuery({ queryFn: useServerFn(getX) })`
- Mutations use `useMutation` + cache invalidation
- Keep the mock generator only for the demo/seed script

### E. mzML parser (Web Worker)
- `src/workers/mzml.worker.ts` — `pako` + `fast-xml-parser`, extracts TIC + per-scan m/z, simple centroid peak picker, FWHM/SN
- Run page: drag-and-drop → worker → `RunSummary` posted back → upload raw file to `raw-runs` bucket via signed upload URL → `createRunFromUpload` server fn writes `runs` + `peaks` rows
- `.raw`/`.wiff`/`.d` accepted for storage but show "convert to mzML for chromatogram extraction" notice

### F. Roles enforcement
- `has_role(auth.uid(), 'admin')` used in RLS and in admin server fns
- Reviewer UI: edit buttons hidden, annotate buttons enabled
- Developer UI: full CRUD on owned rows

---

## Out of scope for Phase 2 (saved for Phase 3)
- PDF report generation
- CSV exports beyond peak tables
- Automated batch annotation matching
- Sharing links

---

## Tech notes
- TanStack Start `createServerFn` for everything; no Supabase Edge Functions
- Loaders stay isomorphic — protected fetches done in components via `useServerFn` + `useQuery`, OR inside `_authenticated/` loaders only
- Service role key only ever read inside `*.server.ts` modules
- File uploads: signed upload URL flow so raw file bytes never pass through the Worker

---

## Order of execution (once you approve and add secrets)
1. Add Supabase clients + types, hand you the SQL migration to run
2. Wait for you to confirm SQL ran cleanly
3. Build auth pages + route guards
4. Migrate routes under `_authenticated/`, swap stores to server fns page-by-page (dashboard → methods → columns → batches → analytes → admin)
5. Wire mzML worker + upload flow on `/runs`
6. Smoke-test as each role

Approve and I'll request the secrets and send you the SQL in the next turn.
