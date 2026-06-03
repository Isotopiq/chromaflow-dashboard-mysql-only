# syntax=docker/dockerfile:1.7
# Production image for CHROMA.LAB (TanStack Start + Vite).
# Serves the built app via `vite preview` on port 5273.

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
RUN bun run build

# ---------- runtime ----------
FROM oven/bun:1.3.3-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5273
# Nitro emits a fully self-contained Node SSR bundle under dist/.
COPY --from=builder /app/dist ./dist
EXPOSE 5273
# Run the SSR server. `vite preview` would only serve the static client
# bundle and break /api routes + server functions (causing the app to hang
# on "Loading…" because /api/public/config returns HTML instead of JSON).
CMD ["bun", "dist/server/index.mjs"]
