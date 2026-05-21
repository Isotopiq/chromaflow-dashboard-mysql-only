# Fix Easypanel environment variable injection

## Actual problem

The app now starts successfully with `vite preview`, so the Docker runtime/router issue is fixed.

The new error is different:

```text
[supabase] Supabase env vars are not all set
error: supabaseUrl is required.
```

This means the container is running, but the Supabase variables are empty inside the container.

The likely cause is the current Compose file:

```yaml
LAB_SUPABASE_URL: ${LAB_SUPABASE_URL:-}
```

In Docker Compose, this is interpolation. If Easypanel stores variables in the service GUI but does not also write them into the Compose interpolation environment, Compose resolves them to empty strings before the container starts. That empty string then overrides any runtime variable with the same name.

## Changes to make

### 1. Docker Compose: stop interpolating secrets

Change the `environment` block from key/value interpolation to a pass-through list:

```yaml
environment:
  - NODE_ENV=production
  - HOST=0.0.0.0
  - PORT=5273
  - LAB_SUPABASE_URL
  - LAB_SUPABASE_ANON_KEY
  - LAB_SUPABASE_SERVICE_ROLE_KEY
  - SUPABASE_URL
  - SUPABASE_ANON_KEY
  - SUPABASE_PUBLISHABLE_KEY
  - SUPABASE_SERVICE_ROLE_KEY
  - SUPABASE_PROJECT_ID
  - LOVABLE_API_KEY
```

This prevents Compose from replacing secrets with empty strings. Easypanel can inject the values from the GUI directly at runtime.

### 2. Server config: do not create Supabase clients with empty values

Update `src/integrations/supabase/client.server.ts` so it validates env vars before calling `createClient()`.

Instead of letting Supabase throw the unclear `supabaseUrl is required`, the app should throw a direct message naming the accepted variable names:

```text
Missing Supabase runtime environment variables. Set either LAB_SUPABASE_URL or SUPABASE_URL, either LAB_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY, and either LAB_SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY.
```

### 3. Keep the previous Docker runtime fix

Keep these existing fixes:

```dockerfile
COPY --from=builder /app/src ./src
```

and:

```ts
cloudflare: false,
tanstackStart: { server: { entry: "server" } }
```

## Easypanel settings

Use the Easypanel service Environment tab and set these exact names:

```text
LAB_SUPABASE_URL=https://your-supabase-url
LAB_SUPABASE_ANON_KEY=your-anon-or-publishable-key
LAB_SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Optional:

```text
LOVABLE_API_KEY=your-key-if-ai-features-are-used
```

## Should you click “Create .env” in Easypanel?

With the updated pass-through Compose file: no, it should not be required.

If Easypanel only supports Compose interpolation in your setup and does not inject GUI variables into Compose services directly, then clicking “Create .env” can make interpolation work. But the better fix is removing interpolation from secrets in `docker-compose.yml`, so the app does not depend on that option.

## Expected result

After redeploying, the container should keep running and should no longer log:

```text
supabaseUrl is required
```

If a variable is still missing, the log will clearly name which accepted env names must be set.