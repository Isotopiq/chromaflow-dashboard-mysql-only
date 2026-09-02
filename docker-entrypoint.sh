#!/bin/sh
set -e

# =====================================================================
# CHROMA.LAB — self-contained entrypoint
# Starts a bundled PostgreSQL, runs migrations, then launches the app.
# =====================================================================

PG_DATA="${PG_DATA:-/app/data/pgdata}"
PG_HOST="127.0.0.1"
PG_PORT="${PG_PORT_INTERNAL:-5432}"
PG_USER="${POSTGRES_USER:-chroma}"
PG_PASS="${POSTGRES_PASSWORD:-chroma}"
PG_DB="${POSTGRES_DB:-chroma_lab}"

# Ensure the socket directory exists.
mkdir -p /run/postgresql
chown postgres:postgres /run/postgresql

# Ensure the uploads directory exists (volume may be empty on first deploy).
mkdir -p /app/data/uploads

# ---- 1. Initialize PostgreSQL data directory (first run only) ----
PG_DATA_CONTENTS=$(ls -A "$PG_DATA" 2>/dev/null || true)
if [ -n "$PG_DATA_CONTENTS" ]; then
  echo "[entrypoint] PG data dir at $PG_DATA has existing data ($(echo "$PG_DATA_CONTENTS" | wc -l) items) — preserving."
else
  echo "[entrypoint] WARNING: PG data dir at $PG_DATA is EMPTY — this is a fresh initialization."
  echo "[entrypoint]   If this appears after a redeploy, the /app/data volume is NOT persistent."
  echo "[entrypoint]   Check Easypanel volume settings to ensure /app/data is mounted to a persistent volume."
  echo "[entrypoint] initializing PostgreSQL data dir at $PG_DATA ..."
  mkdir -p "$PG_DATA"
  chown -R postgres:postgres /app/data
  su-exec postgres initdb -D "$PG_DATA" -U "$PG_USER" --auth=trust
  # Allow local connections without password (app connects via 127.0.0.1).
  echo "host all all 127.0.0.1/32 trust" >> "$PG_DATA/pg_hba.conf"
  echo "host all all ::1/128 trust" >> "$PG_DATA/pg_hba.conf"
  echo "[entrypoint] PostgreSQL initialized."
  # Write a marker file so we can detect future volume resets.
  echo "initialized at $(date -u +%Y-%m-%dT%H:%M:%SZ)" > /app/data/.pg_initialized
fi

# ---- 1a. Diagnostic: check for volume reset ----
if [ -f /app/data/.pg_initialized ] && [ -z "$PG_DATA_CONTENTS" ]; then
  echo "[entrypoint] CRITICAL: /app/data/.pg_initialized exists but PG data dir is empty!"
  echo "[entrypoint]   The volume was partially reset. This should not happen."
elif [ -f /app/data/.pg_initialized ]; then
  echo "[entrypoint] Volume marker found: $(cat /app/data/.pg_initialized)"
fi

# Ensure postgres owns the data dir (volume mount may reset ownership).
chown -R postgres:postgres "$PG_DATA" 2>/dev/null || true

# ---- 1b. Clean up stale lock files from unclean shutdowns ----
# When the container is killed (e.g. Easypanel redeploy), PostgreSQL
# doesn't get a chance to shut down cleanly, leaving behind a stale
# postmaster.pid that prevents the next start.
PID_FILE="$PG_DATA/postmaster.pid"
if [ -f "$PID_FILE" ]; then
  OLD_PID=$(head -1 "$PID_FILE" 2>/dev/null || true)
  if [ -n "$OLD_PID" ]; then
    if ! kill -0 "$OLD_PID" 2>/dev/null; then
      echo "[entrypoint] removing stale postmaster.pid (pid $OLD_PID not running) ..."
      rm -f "$PID_FILE"
    else
      echo "[entrypoint] postmaster.pid exists and pid $OLD_PID is still running — stopping it ..."
      su-exec postgres pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
      rm -f "$PID_FILE"
    fi
  fi
fi
# Also remove stale socket files.
rm -f /run/postgresql/.s.PGSQL.* 2>/dev/null || true
rm -f /run/postgresql/.s.PGSQL.*.lock 2>/dev/null || true

# ---- 2. Start PostgreSQL in the background ----
echo "[entrypoint] starting PostgreSQL ..."
touch /tmp/pg.log
chown postgres:postgres /tmp/pg.log
# Use start -w to wait for startup, and -o to pass port.
if ! su-exec postgres pg_ctl -D "$PG_DATA" -l /tmp/pg.log -o "-p $PG_PORT" -w start 2>&1; then
  # PostgreSQL failed to start — likely WAL corruption from an unclean
  # shutdown (container killed without graceful stop). Try resetting WAL.
  echo "[entrypoint] PostgreSQL failed to start. Checking log..."
  cat /tmp/pg.log 2>/dev/null | tail -10
  if grep -q "could not locate a valid checkpoint record\|invalid record length\|PANIC" /tmp/pg.log 2>/dev/null; then
    echo "[entrypoint] WAL corruption detected — running pg_resetwal ..."
    su-exec postgres pg_resetwal -f "$PG_DATA" 2>&1
    echo "[entrypoint] retrying PostgreSQL start ..."
    rm -f /tmp/pg.log && touch /tmp/pg.log && chown postgres:postgres /tmp/pg.log
    su-exec postgres pg_ctl -D "$PG_DATA" -l /tmp/pg.log -o "-p $PG_PORT" -w start 2>&1 || {
      echo "[entrypoint] PostgreSQL still failed after WAL reset. Log:"
      cat /tmp/pg.log 2>/dev/null || true
      exit 1
    }
  else
    echo "[entrypoint] Non-WAL failure. Log:"
    cat /tmp/pg.log 2>/dev/null || true
    exit 1
  fi
fi

# Wait for PostgreSQL to be ready (belt + suspenders)
echo "[entrypoint] waiting for PostgreSQL ..."
for i in $(seq 1 30); do
  if su-exec postgres pg_isready -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" >/dev/null 2>&1; then
    echo "[entrypoint] PostgreSQL is ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "[entrypoint] PostgreSQL failed to start. Log:"
    cat /tmp/pg.log 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# ---- 3. Create database if it doesn't exist ----
DB_EXISTS=$(su-exec postgres psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -tAc "SELECT 1 FROM pg_database WHERE datname='$PG_DB'" 2>/dev/null | tr -d '[:space:]' || true)
if [ "$DB_EXISTS" != "1" ]; then
  echo "[entrypoint] creating database $PG_DB ..."
  su-exec postgres createdb -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" "$PG_DB" 2>&1 || {
    echo "[entrypoint] database may already exist — continuing."
  }
fi

# ---- 4. Run schema + seed migrations (idempotent) ----
echo "[entrypoint] applying schema ..."
su-exec postgres psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=0 -f /app/schema.sql 2>&1 || {
  echo "[entrypoint] WARNING: schema migration had errors (may be partially applied)."
}
if [ -f /app/seed.sql ]; then
  echo "[entrypoint] applying seed ..."
  su-exec postgres psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -f /app/seed.sql 2>&1 || {
    echo "[entrypoint] WARNING: seed had errors (may be partially applied)."
  }
fi
echo "[entrypoint] migrations done."

# ---- 4b. Diagnostic: show existing data counts ----
echo "[entrypoint] data summary:"
for tbl in app_users methods columns runs analytes batches compound_lists; do
  CNT=$(su-exec postgres psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -tAc "SELECT count(*) FROM public.$tbl" 2>/dev/null || echo "?")
  echo "[entrypoint]   $tbl: $CNT rows"
done

# ---- 5. Ensure DATABASE_URL points at the bundled postgres ----
export DATABASE_URL="postgres://${PG_USER}:${PG_PASS}@${PG_HOST}:${PG_PORT}/${PG_DB}"

echo "[entrypoint] DATABASE_URL=$DATABASE_URL"
echo "[entrypoint] starting CHROMA.LAB on port ${PORT:-29473} ..."

# ---- 6. Start the app (foreground) ----
# Graceful shutdown: stop PostgreSQL when the app exits.
cleanup() {
  echo "[entrypoint] shutting down — stopping PostgreSQL ..."
  su-exec postgres pg_ctl -D "$PG_DATA" stop -m fast 2>/dev/null || true
}
trap cleanup EXIT INT TERM

exec bun dist/server/index.mjs
