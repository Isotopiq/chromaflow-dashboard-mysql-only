// User lifecycle queries. Server-only.
import crypto from "node:crypto";
import { withAdmin } from "@/db/index.server";
import { hashPassword, verifyPassword } from "./password.server";

export type AppUser = {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  created_at: string;
};

export async function findUserByEmail(email: string): Promise<AppUser | null> {
  return withAdmin((db) =>
    db.maybe<AppUser>(
      "select * from public.app_users where lower(email) = lower($1)",
      [email],
    ),
  );
}

export async function findUserById(id: string): Promise<AppUser | null> {
  return withAdmin((db) =>
    db.maybe<AppUser>("select * from public.app_users where id = $1", [id]),
  );
}

export async function createUser(opts: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<AppUser> {
  const hash = await hashPassword(opts.password);
  return withAdmin(async (db) => {
    const existing = await db.maybe<{ id: string }>(
      "select id from public.app_users where lower(email) = lower($1)",
      [opts.email],
    );
    if (existing) throw new Error("An account with this email already exists");
    const row = await db.one<AppUser>(
      `insert into public.app_users (email, password_hash)
       values ($1, $2)
       returning *`,
      [opts.email, hash],
    );
    await db.query("select public.ensure_profile($1, $2)", [
      row.id,
      opts.displayName ?? opts.email.split("@")[0],
    ]);
    return row;
  });
}

export async function authenticate(
  email: string,
  password: string,
): Promise<AppUser> {
  const u = await findUserByEmail(email);
  if (!u) throw new Error("Invalid email or password");
  const ok = await verifyPassword(password, u.password_hash);
  if (!ok) throw new Error("Invalid email or password");
  return u;
}

export async function updateEmail(userId: string, email: string): Promise<void> {
  await withAdmin(async (db) => {
    const dup = await db.maybe<{ id: string }>(
      "select id from public.app_users where lower(email) = lower($1) and id <> $2",
      [email, userId],
    );
    if (dup) throw new Error("Email already in use");
    await db.query(
      "update public.app_users set email = $1, updated_at = now() where id = $2",
      [email, userId],
    );
  });
}

export async function updatePassword(
  userId: string,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  await withAdmin((db) =>
    db.query(
      "update public.app_users set password_hash = $1, reset_token = null, reset_expires_at = null, updated_at = now() where id = $2",
      [hash, userId],
    ),
  );
}

export async function issueResetToken(email: string): Promise<{ token: string; userId: string } | null> {
  const u = await findUserByEmail(email);
  if (!u) return null;
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + 60 * 60_000).toISOString(); // 1h
  await withAdmin((db) =>
    db.query(
      "update public.app_users set reset_token = $1, reset_expires_at = $2 where id = $3",
      [token, expires, u.id],
    ),
  );
  return { token, userId: u.id };
}

export async function consumeResetToken(
  token: string,
  newPassword: string,
): Promise<void> {
  const hash = await hashPassword(newPassword);
  const r = await withAdmin((db) =>
    db.query(
      `update public.app_users
         set password_hash = $1, reset_token = null, reset_expires_at = null, updated_at = now()
       where reset_token = $2 and reset_expires_at > now()
       returning id`,
      [hash, token],
    ),
  );
  if ((r.rowCount ?? 0) === 0) throw new Error("Invalid or expired reset link");
}
