import { createFileRoute } from "@tanstack/react-router";
import { setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { createUser } from "@/lib/auth/users.server";
import { signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from "@/lib/auth/jwt.server";
import { withAdmin } from "@/db/index.server";

const Body = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  displayName: z.string().max(80).optional(),
  inviteCode: z.string().min(4).max(40),
});

export const Route = createFileRoute("/api/auth/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let parsed;
        try {
          parsed = Body.parse(await request.json());
        } catch {
          return Response.json({ error: "Invalid request body" }, { status: 400 });
        }
        const code = parsed.inviteCode.trim().toUpperCase();

        // 1. Pre-validate invite code before creating an account.
        const invite = await withAdmin((db) =>
          db.maybe<{ id: string; role: string; expires_at: string | null; used_at: string | null; revoked_at: string | null }>(
            "select id, role, expires_at, used_at, revoked_at from public.invite_codes where code = $1",
            [code],
          ),
        );
        if (!invite) return Response.json({ error: "Invite code not found" }, { status: 400 });
        if (invite.revoked_at) return Response.json({ error: "Invite code revoked" }, { status: 400 });
        if (invite.used_at) return Response.json({ error: "Invite code already used" }, { status: 400 });
        if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
          return Response.json({ error: "Invite code expired" }, { status: 400 });
        }

        // 2. Create the user.
        let user;
        try {
          user = await createUser({
            email: parsed.email,
            password: parsed.password,
            displayName: parsed.displayName,
          });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Sign-up failed" }, { status: 400 });
        }

        // 3. Claim invite + assign role atomically.
        try {
          await withAdmin(async (db) => {
            const claimed = await db.query(
              `update public.invite_codes
                  set used_by = $1, used_at = now()
                where id = $2 and used_at is null and revoked_at is null`,
              [user.id, invite.id],
            );
            if ((claimed.rowCount ?? 0) === 0) throw new Error("Invite code could not be claimed");
            await db.query("delete from public.user_roles where user_id = $1", [user.id]);
            await db.query("insert into public.user_roles (user_id, role) values ($1, $2)", [user.id, invite.role]);
          });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Invite claim failed" }, { status: 400 });
        }

        // 4. Sign in immediately.
        const token = await signSession({ sub: user.id, email: user.email });
        setCookie(SESSION_COOKIE, token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: SESSION_TTL_SECONDS,
        });
        return Response.json({ ok: true, user: { id: user.id, email: user.email } });
      },
    },
  },
});
