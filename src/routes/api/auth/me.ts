import { createFileRoute } from "@tanstack/react-router";
import { getCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/jwt.server";
import { findUserById } from "@/lib/auth/users.server";

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async () => {
        const token = getCookie(SESSION_COOKIE);
        if (!token) return Response.json({ user: null });
        const claims = await verifySession(token);
        if (!claims) return Response.json({ user: null });
        const u = await findUserById(claims.sub);
        if (!u) return Response.json({ user: null });
        return Response.json({ user: { id: u.id, email: u.email } });
      },
    },
  },
});
