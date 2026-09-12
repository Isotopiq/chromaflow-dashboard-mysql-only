# Easypanel Redeploy Guide — ChromaFlow V4

## Overview

The V4 Docker image has been built and pushed to Docker Hub:

- **`ddlidded/chroma-lab:v4`** — versioned tag (recommended)
- **`ddlidded/chroma-lab:latest`** — floating tag (make sure it was re-pushed)
- **`ddlidded/chroma-lab:v3`** — previous production (rollback)

## REQUIRED: persistent volume

The bundled PostgreSQL database and uploaded files live under `/app/data`.
**If no volume is mounted, the container now refuses to start** (a startup
guard exits with a `FATAL` error) so a redeploy can no longer silently wipe
your data.

### Easypanel volume setup (manual)

1. In the Easypanel service, go to **Storage** (sometimes labelled **Volumes** or **Mounts**).
2. Click **Add Volume** and enter:
   - **Volume name:** `chroma-lab-data`
   - **Mount path (container):** `/app/data`
   - **Type:** named/persistent volume (the default)
3. Save, then deploy.

If you prefer a bind mount to a host directory instead:

- **Host path:** `/var/lib/chroma-lab` (or any host directory you manage)
- **Container path:** `/app/data`

If you intentionally want ephemeral storage (testing only), set the
environment variable `ALLOW_EPHEMERAL=1` to bypass the guard.

## What's new in V4

### New REST API endpoints (`/api/desktop/`)

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/desktop/health` | GET | None | Health check |
| `/api/desktop/login` | POST | None | JWT login (bearer token) |
| `/api/desktop/upload-url` | POST | Bearer | Signed upload URL |
| `/api/desktop/create-run` | POST | Bearer | Create run + peaks + auto-annotate |
| `/api/desktop/find-run` | POST | Bearer | Find run by file path (dedup) |
| `/api/desktop/watch-folders` | GET/POST | Bearer | List/upsert watch folders |
| `/api/desktop/watch-folders/:id` | DELETE | Bearer | Delete watch folder |
| `/api/desktop/lab-data` | GET | Bearer | Methods, columns, batches, compound lists |

### Web UI performance improvements

- Faster page switching (split data loading: core + runs)
- Lazy-loaded reports/PDF/charts (664KB → 40KB shell)
- Memoized lookups in runs list and admin page

### Desktop companion app

- Windows Electron app (NSIS installer built)
- Watches local directories for `.mzXML`/`.mzML` files
- Parses locally, uploads to V3, creates runs automatically

## Redeploy steps

### 1. Update the Easypanel service

1. Log in to your Easypanel dashboard.
2. Navigate to the ChromaFlow service.
3. Go to **Settings** → **Image**.
4. Change the image to one of:
   - `ddlidded/chroma-lab:v4` (pinned version)
   - `ddlidded/chroma-lab:latest` (always latest)
5. Set **Pull Policy** to `Always` (if using `latest`) or `IfNotPresent` (if using `v4`).
6. Click **Save** then **Deploy**.

### 2. Verify the deployment

After the container starts, verify the new endpoints:

```bash
# Health check (no auth needed)
curl http://your-domain/api/desktop/health
# Expected: {"ok":true,"version":"v4"}

# Login (replace with real credentials)
curl -X POST http://your-domain/api/desktop/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email","password":"yourpassword"}'
# Expected: {"token":"...","user":{"id":"...","email":"..."}}
```

### 3. Configure the desktop companion

1. Install the V3 Companion app (`V3 Companion Setup 1.0.0.exe`).
2. Open Settings → API & Connection.
3. Set the API endpoint to your Easypanel domain (e.g., `https://chroma.yourdomain.com`).
4. Enter your ChromaFlow credentials and click Test Connection.
5. Add watch folders for your `.mzXML`/`.mzML` files.

## Rollback

If V4 causes issues, roll back to V3:

1. In Easypanel, change the image back to `ddlidded/chroma-lab:v3`.
2. Click **Deploy**.
3. The V3 image is preserved on Docker Hub and locally.

## Notes

- The V4 image includes all V3 functionality plus the new endpoints.
- No manual database migration is required — the schema script runs on container start and is idempotent (it adds `compound_list_id`, `ms2_blob_path`, etc. if missing).
- The `import_watch_folders` table is created on first use (auto-migrated).
- Existing sessions/cookies remain valid (same JWT signing key).
- The desktop companion app is optional — V4 works perfectly without it.
