import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { authenticate } from "@/lib/auth/users.server";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/jwt.server";

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
        try {
          const user = await authenticate(parsed.email, parsed.password);
          const token = await signSession({ sub: user.id, email: user.email });
          setCookie(SESSION_COOKIE, token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            maxAge: SESSION_TTL_SECONDS,
          });
          return Response.json({ ok: true, user: { id: user.id, email: user.email } });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Sign-in failed" }, { status: 401 });
        }
      },
    },
  },
});
