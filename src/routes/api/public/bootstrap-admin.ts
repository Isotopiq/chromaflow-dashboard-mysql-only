// One-time bootstrap endpoint for creating the first admin user on a fresh
// install. Gated by BOOTSTRAP_TOKEN env var. Disable by clearing that var
// after you've signed in once.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { createUser } from "@/lib/auth/users.server";
import { withAdmin } from "@/db/index.server";

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().max(80).optional(),
  token: z.string().min(1).max(200),
});

export const Route = createFileRoute("/api/public/bootstrap-admin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.BOOTSTRAP_TOKEN;
        if (!expected) {
          return Response.json({ error: "Bootstrap is disabled (BOOTSTRAP_TOKEN not set)" }, { status: 403 });
        }
        let parsed;
        try { parsed = Body.parse(await request.json()); }
        catch { return Response.json({ error: "Invalid request" }, { status: 400 }); }
        if (parsed.token !== expected) {
          return Response.json({ error: "Invalid bootstrap token" }, { status: 403 });
        }
        try {
          const user = await createUser({
            email: parsed.email,
            password: parsed.password,
            displayName: parsed.displayName,
          });
          await withAdmin(async (db) => {
            await db.query("delete from public.user_roles where user_id = $1", [user.id]);
            await db.query(
              "insert into public.user_roles (user_id, role) values ($1, 'admin')",
              [user.id],
            );
          });
          return Response.json({ ok: true, userId: user.id });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Failed" }, { status: 400 });
        }
      },
    },
  },
});
