// Self-hosted build configuration.
//
// `@lovable.dev/vite-tanstack-config` auto-runs Nitro only inside a Lovable
// build. For self-hosted Docker we explicitly enable Nitro with the
// `node-server` preset so `vite build` emits a standalone Node SSR server we
// can run with `node dist/server/index.mjs`.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Self-hosted deployments can whitelist their public hostnames via env var.
// ALLOWED_HOSTS accepts a comma-separated list of hostnames.
// Set ALLOWED_HOSTS=all to disable the host check entirely (safe only
// behind a trusted reverse proxy).
const raw = (process.env.ALLOWED_HOSTS ?? process.env.VITE_ALLOWED_HOSTS ?? "").trim();
const allowedHosts: true | string[] | undefined =
  raw.toLowerCase() === "all"
    ? true
    : raw
        ? raw.split(",").map((h) => h.trim()).filter(Boolean)
        : true;

export default defineConfig({
  nitro: {
    preset: "node-server",
    output: {
      dir: "dist",
      publicDir: "dist/public",
      serverDir: "dist/server",
    },
  },
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    preview: { host: true, allowedHosts },
    server: { host: true, allowedHosts },
  },
});
