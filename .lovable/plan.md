# Fix Docker/Easypanel deployment

## Root cause

The project's `vite.config.ts` enables the `@cloudflare/vite-plugin`, which makes `vite build` emit a Cloudflare Worker bundle instead of the standard Node server file (`dist/server/server.js`). At runtime, `vite preview` invokes TanStack's `preview-server-plugin`, which looks for that Node file and crashes:

```
Cannot find module '/app/dist/server/server.js'
```

So `vite preview` is fundamentally incompatible with the Cloudflare build target. We have to either run the worker via `wrangler`/`workerd` in the container, or switch the build to a plain Node target. For Easypanel/Docker self-hosting, the Node target is the right call — it's lighter, faster to boot, and matches how `vite preview` already works.

## Plan

### 1. Disable the Cloudflare plugin for self-hosted builds

Edit `vite.config.ts`:

```ts
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  cloudflare: false,
  tanstackStart: { server: { entry: "server" } },
});
```

The Lovable wrapper only attaches `@cloudflare/vite-plugin` when `cloudflare !== false`. With it off, `vite build` produces `dist/client/` (static assets) and `dist/server/server.js` (Node SSR entry), and `vite preview` serves them correctly.

This change only affects self-hosted builds. Lovable's cloud preview/publish runs through its own pipeline and is unaffected.

### 2. Simplify the Dockerfile

- Remove the `ARG VITE_SUPABASE_*` build args and the `COPY --from=builder /app/src ./src` line — neither is needed anymore. The browser already fetches Supabase config at runtime from `/api/public/config` (see `src/integrations/supabase/client.ts`), so no `VITE_*` value has to be baked into the client bundle.
- Keep only `dist/`, `node_modules/`, and `package.json` in the runtime image.

### 3. Rewrite `docker-compose.yml` to be Easypanel-native

- No `build.args` block (nothing to bake in at build time).
- All Supabase vars are runtime-only `environment:` entries, passed through from Easypanel's env vars with `${VAR}` interpolation (no `:?` strict checks, since Easypanel injects env at container runtime, not at compose-parse time).
- Service exposes port 5273, restart policy `unless-stopped`, healthcheck on `/`.

### 4. Required Easypanel environment variables

Only **server-side** vars are needed (no `VITE_*` prefix required at build):

- `SUPABASE_URL` — your self-hosted Supabase URL
- `SUPABASE_PUBLISHABLE_KEY` — anon key
- `SUPABASE_SERVICE_ROLE_KEY` — service role key
- `SUPABASE_PROJECT_ID` — any placeholder string (e.g. `selfhosted`)
- `LOVABLE_API_KEY` — optional, only if AI features are used

## Files changed

- `vite.config.ts` — add `cloudflare: false`
- `Dockerfile` — drop build args, drop `src/` copy
- `docker-compose.yml` — remove build args, runtime env only

## Verification

After redeploy, `vite preview` should boot cleanly and serve the SSR bundle from `dist/server/server.js` on port 5273.
