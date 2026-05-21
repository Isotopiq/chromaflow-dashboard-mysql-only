# syntax=docker/dockerfile:1.7
# Multi-stage build for the CHROMA.LAB TanStack Start app.
# Produces a small runtime image that serves the production build with
# `vite preview` on port 5273.

# ---------- deps ----------
# Bun 1.3.x reports a Vite-compatible Node runtime (22.12+ / 24.x).
FROM oven/bun:1.3.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* package-lock.json* ./
RUN bun install --frozen-lockfile || bun install

# ---------- builder ----------
FROM oven/bun:1.3.3-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time Supabase env vars are required for the client bundle.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID
RUN bun run build

# ---------- runtime ----------
FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5273
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/vite.config.ts ./vite.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
EXPOSE 5273
CMD ["bun", "run", "preview", "--host", "0.0.0.0", "--port", "5273"]
