// Health check endpoint for the V3 desktop companion.
// No auth required — used by the desktop app's "Test Connection" button.
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/desktop/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({ ok: true, version: "v4" });
      },
    },
  },
});
