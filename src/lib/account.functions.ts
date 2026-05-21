import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function avatarPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const { data } = supabaseAdmin.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl ?? null;
}

export const getMyAccount = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(userId);
    return {
      id: userId,
      email: userRes?.user?.email ?? "",
      displayName: profile?.display_name ?? "",
      avatarPath: profile?.avatar_url ?? null,
      avatarUrl: avatarPublicUrl(profile?.avatar_url),
    };
  });

const ProfileInput = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  avatarPath: z.string().max(500).nullable().optional(),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ProfileInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const patch: Record<string, unknown> = { id: userId };
    if (data.displayName !== undefined) patch.display_name = data.displayName;
    if (data.avatarPath !== undefined) patch.avatar_url = data.avatarPath;
    const { error } = await supabaseAdmin
      .from("profiles")
      .upsert(patch, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  });

const EmailInput = z.object({ email: z.string().email().max(254) });

export const updateMyEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => EmailInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    // Admin update: takes effect immediately (no confirmation email round-trip).
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: data.email,
    });
    if (error) throw error;
    return { ok: true };
  });

const PasswordInput = z.object({ password: z.string().min(8).max(200) });

export const updateMyPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => PasswordInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: data.password,
    });
    if (error) throw error;
    return { ok: true };
  });
