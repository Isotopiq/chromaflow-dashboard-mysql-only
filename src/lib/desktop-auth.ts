// Bearer token auth helper for desktop companion REST endpoints.
//
// Reads the JWT from the Authorization header (instead of the session cookie),
// verifies it, resolves the user's role + permissions, and runs the handler
// inside a DB transaction with the correct RLS context. Mirrors the logic in
// auth-middleware.ts's `requireAuth` but for REST handlers (createFileRoute)
// rather than server functions (createServerFn).
//
// IMPORTANT: the handler runs INSIDE withDb — `ctx.db` is only valid for the
// duration of the callback. Returning `db` from the callback and using it
// afterwards would fail because the pooled client is released on return.

import { verifySession } from "./auth/jwt.server";
import { withDb, type Db, type AuthCtx } from "@/db/index.server";

export type AppRole = "admin" | "developer" | "reviewer" | "user";

export type PermissionFlags = {
  isAdmin: boolean;
  canEdit: boolean;
  canAnnotate: boolean;
  canReview: boolean;
  canDelete: boolean;
};

export type BearerAuthContext = {
  userId: string;
  email: string;
  role: AppRole;
  db: Db;
} & PermissionFlags;

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

const PRIORITY: AppRole[] = ["admin", "developer", "reviewer", "user"];

/**
 * Extract + verify the bearer token from the Authorization header, resolve
 * the user's role, and run `fn(ctx)` inside a DB transaction with RLS context.
 *
 * Throws a Response(401) if the token is missing, invalid, or expired.
 * Any error thrown by `fn` rolls the transaction back and propagates — return
 * a Response from `fn` for expected client errors instead of throwing.
 */
export async function requireBearerAuth<T>(
  request: Request,
  fn: (ctx: BearerAuthContext) => Promise<T>,
): Promise<T> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Response("Unauthorized — missing bearer token", { status: 401 });
  }
  const token = match[1];
  const claims = await verifySession(token);
  if (!claims) {
    throw new Response("Unauthorized — invalid or expired token", { status: 401 });
  }

  const authCtx: AuthCtx = { userId: claims.sub };

  return withDb(authCtx, async (db) => {
    // The JWT may outlive the user row (e.g. DB reset or recreated account).
    // Verify the user still exists — otherwise inserts that reference
    // uploaded_by fail with a foreign-key violation.
    const u = await db.maybe<{ id: string }>(
      "select id from public.app_users where id = $1",
      [claims.sub],
    );
    if (!u) {
      throw new Response("Unauthorized — user no longer exists, please sign in again", { status: 401 });
    }

    // Resolve role — pick the highest-privilege role if the user has multiple.
    const r = await db.query<{ role: string }>(
      "select role from public.user_roles where user_id = $1",
      [claims.sub],
    );
    const roles = r.rows.map((x) => x.role as AppRole);
    const role: AppRole = PRIORITY.find((p) => roles.includes(p)) ?? "user";
    const flags = roleToFlags(role);

    return fn({
      userId: claims.sub,
      email: claims.email,
      role,
      ...flags,
      db,
    });
  });
}
