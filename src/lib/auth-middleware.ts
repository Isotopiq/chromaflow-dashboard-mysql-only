// Replaces the old Supabase auth middleware. Reads our JWT session cookie,
// verifies it, looks up the user, and injects { userId, email, isAdmin, db }
// into server-fn context. The handler can use `context.db` for queries and
// RLS will scope them automatically.
import { createMiddleware } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE, verifySession } from "./auth/jwt.server";
import { withDb, type Db } from "@/db/index.server";

declare module "@tanstack/react-start" {
  // Augment context (best-effort; the actual injected fields below).
}

export const requireAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const token = getCookie(SESSION_COOKIE);
    if (!token) throw new Response("Unauthorized", { status: 401 });
    const claims = await verifySession(token);
    if (!claims) throw new Response("Unauthorized", { status: 401 });

    return withDb({ userId: claims.sub }, async (db) => {
      // Resolve admin flag once per request so other helpers can rely on it.
      const r = await db.query<{ role: string }>(
        "select role from public.user_roles where user_id = $1",
        [claims.sub],
      );
      const isAdmin = r.rows.some((x) => x.role === "admin");
      return next({
        context: { userId: claims.sub, email: claims.email, isAdmin, db } as {
          userId: string; email: string; isAdmin: boolean; db: Db;
        },
      });
    });
  },
);
