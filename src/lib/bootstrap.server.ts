// Idempotent first-admin bootstrap from env vars.
//
// Set ADMIN_EMAIL + ADMIN_PASSWORD (and optionally ADMIN_DISPLAY_NAME) in the
// environment. On server startup, if no user exists with that email:
//   - create the user (with email_verified_at = now() so they can log in
//     immediately without an email verification loop)
//   - assign the 'admin' role
// If the user already exists, we just ensure they have the admin role.
//
// Safe to leave set across restarts — it only acts when needed and never
// overwrites an existing user's password.
import { withAdmin } from "@/db/index.server";
import { hashPassword } from "@/lib/auth/password.server";

type ExistingUser = { id: string };

export async function bootstrapAdminFromEnv(): Promise<void> {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  const displayName = (process.env.ADMIN_DISPLAY_NAME ?? "").trim() || undefined;

  if (!email || !password) return; // not configured — nothing to do

  if (password.length < 8) {
    console.warn(
      "[bootstrap] ADMIN_PASSWORD is set but shorter than 8 chars — skipping admin bootstrap.",
    );
    return;
  }

  try {
    await withAdmin(async (db) => {
      const existing = await db.maybe<ExistingUser>(
        "select id from public.app_users where lower(email) = lower($1)",
        [email],
      );

      if (existing) {
        // Ensure the admin role exists (idempotent).
        await db.query(
          `insert into public.user_roles (user_id, role)
           values ($1, 'admin')
           on conflict (user_id, role) do nothing`,
          [existing.id],
        );
        console.info(
          `[bootstrap] admin user '${email}' already exists — admin role ensured.`,
        );
        return;
      }

      // Create the user + admin role in one transaction.
      const hash = await hashPassword(password);
      const row = await db.one<{ id: string }>(
        `insert into public.app_users (email, password_hash, email_verified_at)
         values ($1, $2, now())
         returning id`,
        [email, hash],
      );
      await db.query("select public.ensure_profile($1, $2)", [
        row.id,
        displayName ?? email.split("@")[0],
      ]);
      await db.query(
        `insert into public.user_roles (user_id, role)
         values ($1, 'admin')
         on conflict (user_id, role) do nothing`,
        [row.id],
      );
      console.info(`[bootstrap] created first admin user '${email}'.`);
    });
  } catch (e) {
    // Don't crash the server if the DB isn't ready yet — the healthcheck +
    // restart policy will recover. Just log loudly.
    console.error(
      "[bootstrap] failed to create admin from env:",
      (e as Error)?.message ?? e,
    );
  }
}
