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
# Entrypoint script that starts postgres + app together.
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# Persistent data: postgres + uploads share /app/data.
RUN mkdir -p /app/data/uploads /app/data/pgdata && \
    chown -R postgres:postgres /app/data/pgdata

# Declare /app/data as a Docker volume so Docker automatically preserves
# it across container recreations even if the compose file doesn't
# explicitly mount a volume. Easypanel may not always honor bind mounts
# from docker-compose.yml; this ensures persistence as a fallback.
VOLUME ["/app/data"]

EXPOSE 29473

# The entrypoint initializes postgres, runs migrations, then starts the app.
CMD ["/app/docker-entrypoint.sh"]
