import { createFileRoute } from "@tanstack/react-router";
import { deleteCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE } from "@/lib/auth/jwt.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async () => {
        deleteCookie(SESSION_COOKIE, { path: "/" });
        return Response.json({ ok: true });
      },
    },
  },
});
