import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import { withAdmin } from "@/db/index.server";
import { createSignedDownloadUrl } from "@/lib/storage.server";
import { updateEmail, updatePassword } from "@/lib/auth/users.server";

export const getMyAccount = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId, email, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const profile = await db.maybe(
      "select id, display_name, avatar_url from public.profiles where id = $1",
      [userId],
    );
    return {
      id: userId,
      email,
      displayName: profile?.display_name ?? "",
      avatarPath: profile?.avatar_url ?? null,
      avatarUrl: publicUrl("avatars", profile?.avatar_url),
    };
  });

const ProfileInput = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  avatarPath: z.string().max(500).nullable().optional(),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ProfileInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    // Ensure profile exists, then patch fields
    await db.query(
      `insert into public.profiles (id, display_name, avatar_url)
       values ($1, $2, $3)
       on conflict (id) do update set
         display_name = coalesce($2, public.profiles.display_name),
         avatar_url   = case when $4 then $3 else public.profiles.avatar_url end,
         updated_at   = now()`,
      [
        userId,
        data.displayName ?? null,
        data.avatarPath ?? null,
        data.avatarPath !== undefined,
      ],
    );
    return { ok: true };
  });

const EmailInput = z.object({ email: z.string().email().max(254) });

export const updateMyEmail = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => EmailInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    await updateEmail(userId, data.email);
    return { ok: true };
  });

const PasswordInput = z.object({ password: z.string().min(8).max(200) });

export const updateMyPassword = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => PasswordInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    await updatePassword(userId, data.password);
    // Touch withAdmin only if we want to bypass anything — not needed here.
    void withAdmin;
    return { ok: true };
  });
