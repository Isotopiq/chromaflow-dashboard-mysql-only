import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import { withAdmin } from "@/db/index.server";
import { publicUrl } from "@/lib/storage.server";

// ---- Branding ----
// Public read.
export const getBranding = createServerFn({ method: "GET" }).handler(async () => {
  const data = await withAdmin((db) =>
    db.maybe<any>("select * from public.branding_settings where id = 1"),
  );
  return {
    appName: data?.app_name ?? null,
    faviconPath: data?.favicon_path ?? null,
    webLogoPath: data?.web_logo_path ?? null,
    pdfLogoPath: data?.pdf_logo_path ?? null,
    faviconUrl: publicUrl("branding", data?.favicon_path),
    webLogoUrl: publicUrl("branding", data?.web_logo_path),
    pdfLogoUrl: publicUrl("branding", data?.pdf_logo_path),
  };
});

function requireAdmin(isAdmin: boolean) {
  if (!isAdmin) throw new Response("Forbidden — admin only", { status: 403 });
}

const BrandingInput = z.object({
  appName: z.string().max(60).nullable().optional(),
  faviconPath: z.string().max(500).nullable().optional(),
  webLogoPath: z.string().max(500).nullable().optional(),
  pdfLogoPath: z.string().max(500).nullable().optional(),
});

export const setBranding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => BrandingInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, isAdmin, db } = context as any;
    requireAdmin(isAdmin);
    await db.query(
      `insert into public.branding_settings
         (id, app_name, favicon_path, web_logo_path, pdf_logo_path, updated_at, updated_by)
       values (1, $1, $2, $3, $4, now(), $5)
       on conflict (id) do update set
         app_name      = case when $6 then $1 else public.branding_settings.app_name end,
         favicon_path  = case when $7 then $2 else public.branding_settings.favicon_path end,
         web_logo_path = case when $8 then $3 else public.branding_settings.web_logo_path end,
         pdf_logo_path = case when $9 then $4 else public.branding_settings.pdf_logo_path end,
         updated_at    = now(),
         updated_by    = $5`,
      [
        data.appName ?? null,
        data.faviconPath ?? null,
        data.webLogoPath ?? null,
        data.pdfLogoPath ?? null,
        userId,
        data.appName !== undefined,
        data.faviconPath !== undefined,
        data.webLogoPath !== undefined,
        data.pdfLogoPath !== undefined,
      ],
    );
    return { ok: true };
  });

// ---- Invite codes ----
const CreateInviteInput = z.object({
  role: z.enum(["admin", "developer", "reviewer"]).default("developer"),
  expiresInDays: z.number().int().min(1).max(365).optional(),
  note: z.string().max(200).optional(),
});

function genCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

export const createInviteCode = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => CreateInviteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, isAdmin, db } = context as any;
    requireAdmin(isAdmin);
    const code = genCode();
    const expires_at = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 86400_000).toISOString()
      : null;
    const row = await db.one(
      `insert into public.invite_codes (code, role, note, expires_at, created_by)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [code, data.role, data.note ?? null, expires_at, userId],
    );
    return row;
  });

export const listInviteCodes = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { isAdmin, db } = context as any;
    requireAdmin(isAdmin);
    return db.many(
      "select * from public.invite_codes order by created_at desc limit 200",
    );
  });

export const revokeInviteCode = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { isAdmin, db } = context as any;
    requireAdmin(isAdmin);
    await db.query(
      "update public.invite_codes set revoked_at = now() where id = $1 and used_at is null",
      [data.id],
    );
    return { ok: true };
  });

// Pre-signup validation (no auth required).
export const validateInviteCode = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ code: z.string().min(4).max(40) }).parse(d))
  .handler(async ({ data }) => {
    const code = data.code.trim().toUpperCase();
    const row = await withAdmin((db) =>
      db.maybe<any>(
        "select id, role, expires_at, used_at, revoked_at from public.invite_codes where code = $1",
        [code],
      ),
    );
    if (!row) return { ok: false as const, reason: "Code not found" };
    if (row.revoked_at) return { ok: false as const, reason: "Code has been revoked" };
    if (row.used_at) return { ok: false as const, reason: "Code already used" };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now())
      return { ok: false as const, reason: "Code expired" };
    return { ok: true as const, role: row.role as "admin" | "developer" | "reviewer" };
  });
