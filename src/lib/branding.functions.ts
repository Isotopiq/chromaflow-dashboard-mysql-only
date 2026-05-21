import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { setUserRoleAdmin } from "./lab-data.server";

const BUCKET = "branding";

function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl ?? null;
}

// ---- Branding ----
// Public read (used to render favicon/logo even on auth pages).
export const getBranding = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("branding_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error && !/relation .* does not exist/i.test(error.message ?? "")) {
    throw error;
  }
  return {
    appName: data?.app_name ?? null,
    faviconPath: data?.favicon_path ?? null,
    webLogoPath: data?.web_logo_path ?? null,
    pdfLogoPath: data?.pdf_logo_path ?? null,
    faviconUrl: publicUrl(data?.favicon_path),
    webLogoUrl: publicUrl(data?.web_logo_path),
    pdfLogoUrl: publicUrl(data?.pdf_logo_path),
  };
});

async function requireAdmin(supabase: any, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (!(data ?? []).some((r: any) => r.role === "admin")) {
    throw new Response("Forbidden — admin only", { status: 403 });
  }
}

const BrandingInput = z.object({
  appName: z.string().max(60).nullable().optional(),
  faviconPath: z.string().max(500).nullable().optional(),
  webLogoPath: z.string().max(500).nullable().optional(),
  pdfLogoPath: z.string().max(500).nullable().optional(),
});

export const setBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => BrandingInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await requireAdmin(supabase, userId);
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };
    if (data.appName !== undefined) patch.app_name = data.appName;
    if (data.faviconPath !== undefined) patch.favicon_path = data.faviconPath;
    if (data.webLogoPath !== undefined) patch.web_logo_path = data.webLogoPath;
    if (data.pdfLogoPath !== undefined) patch.pdf_logo_path = data.pdfLogoPath;
    const { error } = await supabaseAdmin
      .from("branding_settings")
      .upsert({ id: 1, ...patch }, { onConflict: "id" });
    if (error) throw error;
    return { ok: true };
  });

// ---- Invite codes ----
const CreateInviteInput = z.object({
  role: z.enum(["admin", "developer", "reviewer"]).default("developer"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  note: z.string().max(200).optional(),
});

function genCode(): string {
  // 12-char base32-style code, blocked for readability.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

export const createInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateInviteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await requireAdmin(supabase, userId);
    const code = genCode();
    const expires_at = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 86400_000).toISOString()
      : null;
    const { data: row, error } = await supabaseAdmin
      .from("invite_codes")
      .insert({
        code,
        role: data.role,
        note: data.note ?? null,
        expires_at,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const listInviteCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await requireAdmin(supabase, userId);
    const { data, error } = await supabaseAdmin
      .from("invite_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return data ?? [];
  });

export const revokeInviteCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await requireAdmin(supabase, userId);
    const { error } = await supabaseAdmin
      .from("invite_codes")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .is("used_at", null);
    if (error) throw error;
    return { ok: true };
  });

// Pre-signup: cheap validity check. No auth required.
export const validateInviteCode = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z.object({ code: z.string().min(4).max(40) }).parse(d),
  )
  .handler(async ({ data }) => {
    const code = data.code.trim().toUpperCase();
    const { data: row } = await supabaseAdmin
      .from("invite_codes")
      .select("id, role, expires_at, used_at, revoked_at")
      .eq("code", code)
      .maybeSingle();
    if (!row) return { ok: false, reason: "Code not found" };
    if (row.revoked_at) return { ok: false, reason: "Code has been revoked" };
    if (row.used_at) return { ok: false, reason: "Code already used" };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
      return { ok: false, reason: "Code expired" };
    return { ok: true, role: row.role as "admin" | "developer" | "reviewer" };
  });

// Post-signup: mark code consumed AND assign role.
// No auth middleware because the new user may not be confirmed yet.
// Safe because (a) we re-validate the code, (b) we require a matching
// auth.users row for the newUserId.
export const consumeInviteCode = createServerFn({ method: "POST" })
  .inputValidator((d) =>
    z
      .object({
        code: z.string().min(4).max(40),
        newUserId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const code = data.code.trim().toUpperCase();
    const { data: row, error: fetchErr } = await supabaseAdmin
      .from("invite_codes")
      .select("*")
      .eq("code", code)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!row) throw new Error("Invite code not found");
    if (row.revoked_at) throw new Error("Invite code has been revoked");
    if (row.used_at) throw new Error("Invite code already used");
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
      throw new Error("Invite code expired");

    // Verify the user actually exists in auth.
    const { data: userRes, error: userErr } =
      await supabaseAdmin.auth.admin.getUserById(data.newUserId);
    if (userErr || !userRes?.user) throw new Error("New user not found");

    // Atomic-ish claim: only succeeds if still unclaimed.
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("invite_codes")
      .update({ used_by: data.newUserId, used_at: new Date().toISOString() })
      .eq("id", row.id)
      .is("used_at", null)
      .is("revoked_at", null)
      .select()
      .single();
    if (claimErr || !claimed) throw new Error("Invite code could not be claimed");

    await setUserRoleAdmin(data.newUserId, row.role);
    return { ok: true, role: row.role };
  });
