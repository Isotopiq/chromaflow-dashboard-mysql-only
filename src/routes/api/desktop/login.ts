// Desktop companion login endpoint.
// Returns a JWT in the JSON body (instead of setting a cookie like /api/auth/login).
// The desktop app stores this token and sends it as a Bearer token on
// subsequent requests.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { authenticate } from "@/lib/auth/users.server";
import { signSession } from "@/lib/auth/jwt.server";

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const Route = createFileRoute("/api/desktop/login")({
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
          return Response.json({ token, user: { id: user.id, email: user.email } });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Sign-in failed" }, { status: 401 });
        }
      },
    },
  },
});
