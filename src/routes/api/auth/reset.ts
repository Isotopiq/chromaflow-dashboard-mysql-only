import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { consumeResetToken } from "@/lib/auth/users.server";

const Body = z.object({
  token: z.string().min(8).max(200),
  password: z.string().min(8).max(200),
});

export const Route = createFileRoute("/api/auth/reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try { parsed = Body.parse(await request.json()); }
        catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
        try {
          await consumeResetToken(parsed.token, parsed.password);
          return Response.json({ ok: true });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Reset failed" }, { status: 400 });
        }
      },
    },
  },
});
