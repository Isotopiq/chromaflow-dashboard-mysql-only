# Fix Easypanel Docker Compose deployment

## Goal

Make this app deploy cleanly as a single Easypanel Compose service and stop the current container loop:

```text
Cannot find module '/app/dist/server/server.js'
```

## Root cause

The Docker container runs:

```text
vite preview --host 0.0.0.0 --port 5273
```

That runtime expects a normal TanStack/Vite production output containing `dist/server/server.js`. The current build is still using the Cloudflare build plugin, which produces a different server bundle layout. So the image builds, but the preview server cannot find the expected server entry when the container starts.

## Plan

### 1. Make the self-hosted Docker build produce the expected server output

Update `vite.config.ts` to disable the Cloudflare build plugin for this repo’s Docker build while keeping the existing TanStack server entry:

```ts
export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
});
```

This is the direct fix for the missing `/app/dist/server/server.js` error.

### 2. Replace the Dockerfile with a clean Easypanel-compatible production image

Keep a simple multi-stage Bun image:

- install dependencies
- build the app
- copy only `dist`, `node_modules`, `package.json`, and the small config files needed by `vite preview`
- expose container port `5273`
- run `bun run preview --host 0.0.0.0 --port 5273`

Remove the previous workaround that copied `src/` into the runtime image. Once the build target is correct, the runtime image should not need source files.

### 3. Rewrite `docker-compose.yml` in Easypanel style

Use a minimal Compose service:

- one service: `chroma-lab`
- `build: .`
- `restart: unless-stopped`
- `ports: "5273:5273"`
- runtime `environment:` only
- no `build.args`
- no strict `${VAR:?message}` interpolation, because that caused Easypanel deploy failures before
- healthcheck against `http://127.0.0.1:5273/`

### 4. Environment variables to set in Easypanel

Use these runtime variables in the Easypanel service UI:

```text
SUPABASE_URL=https://your-self-hosted-supabase-url
SUPABASE_PUBLISHABLE_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_PROJECT_ID=selfhosted
VITE_SUPABASE_URL=https://your-self-hosted-supabase-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-or-publishable-key
VITE_SUPABASE_PROJECT_ID=selfhosted
```

`LOVABLE_API_KEY` stays optional and should only be set if the app uses Lovable AI features.

## Files to change

- `vite.config.ts`
- `Dockerfile`
- `docker-compose.yml`

## Expected result

After redeploying in Easypanel, the container should start once, keep running, and serve the app on port `5273` without the missing `dist/server/server.js` error.
