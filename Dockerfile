# syntax=docker/dockerfile:1.7
# Production image for CHROMA.LAB (TanStack Start + Vite).
# Self-contained: bundles PostgreSQL + the SSR app in one container.

# ---------- deps ----------
FROM oven/bun:1.3.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* package-lock.json* ./
RUN bun install --frozen-lockfile || bun install

# ---------- builder ----------
FROM oven/bun:1.3.3-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Cap the JS heap so the build stays inside the container memory limit instead
# of being SIGKILLed ("cannot allocate memory") on small hosts.
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=2048 \
    ROLLUP_NO_NATIVE=1
RUN bun run build

# ---------- runtime (self-contained: bun + postgres) ----------
FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app

# Install PostgreSQL 17 + extensions into the bun/alpine image.
RUN apk add --no-cache \
    postgresql17 \
    postgresql17-client \
    postgresql17-contrib \
    su-exec \
    wget

# Create postgres user if it doesn't exist (alpine image may not have it).
RUN id postgres >/dev/null 2>&1 || adduser -D -u 70 postgres

# PostgreSQL needs /run/postgresql for its socket directory.
RUN mkdir -p /run/postgresql && chown postgres:postgres /run/postgresql

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=29473 \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=29473 \
    PG_DATA=/app/data/pgdata \
    PG_PORT_INTERNAL=5432

# Nitro emits a fully self-contained Node SSR bundle under dist/.
COPY --from=builder /app/dist ./dist
# Schema + seed for auto-migration on startup.
COPY chroma_lab_full_schema.sql /app/schema.sql
COPY seed_common_analytes.sql /app/seed.sql
# Strip CRLF line endings (file may have Windows line endings from git checkout
# on Windows; psql in Alpine chokes on \r in $$ ... $$ PL/pgSQL blocks).
RUN sed -i 's/\r$//' /app/schema.sql /app/seed.sql
# Entrypoint script that starts postgres + app together.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
# Strip CRLF line endings (file has Windows line endings from git checkout on
# Windows; the shebang #!/bin/sh\r would cause "not found" errors in Alpine).
RUN sed -i 's/\r$//' /app/docker-entrypoint.sh && chmod +x /app/docker-entrypoint.sh

# Persistent data: postgres + uploads share /app/data.
RUN mkdir -p /app/data/uploads /app/data/pgdata && \
    chown -R postgres:postgres /app/data/pgdata

# NOTE: Do NOT declare VOLUME ["/app/data"] here. The VOLUME directive causes
# Docker to create a NEW anonymous volume on every container recreation, which
# wipes data on redeploy. Instead, let Easypanel (or docker-compose) manage the
# volume explicitly via a named volume mount at /app/data.

EXPOSE 29473

# The entrypoint initializes postgres, runs migrations, then starts the app.
CMD ["/app/docker-entrypoint.sh"]
