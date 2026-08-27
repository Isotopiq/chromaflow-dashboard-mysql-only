// Replaces the old Supabase auth middleware. Reads our JWT session cookie,
// verifies it, looks up the user, and injects { userId, email, role, isAdmin, canEdit, canAnnotate, canReview, db }
// into server-fn context. The handler can use `context.db` for queries and
// RLS will scope them automatically.
//
// Permission model:
//   admin     — full access, user management, delete anything
//   developer — create/edit all methods, runs, columns
//   reviewer  — read-all, annotate peaks, review batches
//   user      — view all shared data, edit own profile only
import { createMiddleware } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { SESSION_COOKIE, verifySession } from "./auth/jwt.server";
import { withDb, type Db } from "@/db/index.server";

export type AppRole = "admin" | "developer" | "reviewer" | "user";

export type PermissionFlags = {
  isAdmin: boolean;
  canEdit: boolean;     // create/edit methods, runs, columns
  canAnnotate: boolean;  // annotate peaks
  canReview: boolean;    // review/approve batches
  canDelete: boolean;    // delete methods, runs, columns, batches
};

function roleToFlags(role: AppRole): PermissionFlags {
  switch (role) {
    case "admin":
      return { isAdmin: true, canEdit: true, canAnnotate: true, canReview: true, canDelete: true };
    case "developer":
      return { isAdmin: false, canEdit: true, canAnnotate: true, canReview: false, canDelete: true };
    case "reviewer":
      return { isAdmin: false, canEdit: false, canAnnotate: true, canReview: true, canDelete: false };
    case "user":
      return { isAdmin: false, canEdit: false, canAnnotate: false, canReview: false, canDelete: false };
  }
}

export function requirePermission(flags: PermissionFlags, perm: keyof PermissionFlags) {
  if (!flags[perm]) throw new Response("Forbidden — insufficient permissions", { status: 403 });
}

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
      // Resolve role once per request so permission checks can rely on it.
      const r = await db.query<{ role: string }>(
        "select role from public.user_roles where user_id = $1",
        [claims.sub],
      );
      // Pick the highest-privilege role if the user has multiple.
      const priority: AppRole[] = ["admin", "developer", "reviewer", "user"];
      const roles = r.rows.map((x) => x.role as AppRole);
      const role: AppRole = priority.find((p) => roles.includes(p)) ?? "user";
      const flags = roleToFlags(role);
      return next({
        context: {
          userId: claims.sub,
          email: claims.email,
          role,
          ...flags,
          db,
        } as {
          userId: string; email: string; role: AppRole; db: Db;
        } & PermissionFlags,
      });
    });
  },
);
