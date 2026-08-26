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
if [ ! -d "$PG_DATA" ] || [ -z "$(ls -A "$PG_DATA" 2>/dev/null)" ]; then
  echo "[entrypoint] initializing PostgreSQL data dir at $PG_DATA ..."
  mkdir -p "$PG_DATA"
  chown -R postgres:postgres /app/data
  su-exec postgres initdb -D "$PG_DATA" -U "$PG_USER" --auth=trust
  # Allow local connections without password (app connects via 127.0.0.1).
  echo "host all all 127.0.0.1/32 trust" >> "$PG_DATA/pg_hba.conf"
  echo "host all all ::1/128 trust" >> "$PG_DATA/pg_hba.conf"
  echo "[entrypoint] PostgreSQL initialized."
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
su-exec postgres pg_ctl -D "$PG_DATA" -l /tmp/pg.log -o "-p $PG_PORT" -w start

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
su-exec postgres psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -f /app/schema.sql 2>&1 || {
  echo "[entrypoint] WARNING: schema migration had errors (may be partially applied)."
}
if [ -f /app/seed.sql ]; then
  echo "[entrypoint] applying seed ..."
  su-exec postgres psql -h "$PG_HOST" -p "$PG_PORT" -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 -f /app/seed.sql 2>&1 || {
    echo "[entrypoint] WARNING: seed had errors (may be partially applied)."
  }
fi
echo "[entrypoint] migrations done."

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
