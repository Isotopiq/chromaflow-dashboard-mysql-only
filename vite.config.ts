// @lovable.dev/vite-tanstack-config injects framework defaults.
// We disable the Cloudflare build plugin so `vite build` emits the standard
// Node SSR output at dist/server/server.js, which is what `vite preview`
// (used by the self-hosted Docker image) expects.
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
        : undefined;

export default defineConfig({
  cloudflare: false,
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    preview: { host: true, allowedHosts },
    server: { host: true, allowedHosts },
  },
});
