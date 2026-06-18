import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import { withAdmin } from "@/db/index.server";
import { publicUrl, createSignedDownloadUrl } from "@/lib/storage.server";

async function resolveBrandingUrl(
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null;
  // Try a signed download URL first — works for private S3/R2 buckets.
  try {
    return await createSignedDownloadUrl("branding", path, 60 * 60 * 24);
  } catch {
    // Fall back to a constructed public URL if signing fails (e.g. no creds).
    return publicUrl("branding", path);
  }
}

// ---- Branding ----
// Public read.
export const getBranding = createServerFn({ method: "GET" }).handler(async () => {
  const data = await withAdmin((db) =>
    db.maybe<any>("select * from public.branding_settings where id = 1"),
  );
  const faviconUrlExplicit = (data?.favicon_url as string | null) ?? null;
  const webLogoUrlExplicit = (data?.web_logo_url as string | null) ?? null;
  const pdfLogoUrlExplicit = (data?.pdf_logo_url as string | null) ?? null;
  const webLogoLightUrlExplicit = (data?.web_logo_light_url as string | null) ?? null;
  const webLogoDarkUrlExplicit = (data?.web_logo_dark_url as string | null) ?? null;
  const [webLogoUrlSigned, webLogoLightUrlSigned, webLogoDarkUrlSigned, pdfLogoUrlSigned, faviconUrlSigned] =
    await Promise.all([
      resolveBrandingUrl(data?.web_logo_path),
      resolveBrandingUrl(data?.web_logo_light_path),
      resolveBrandingUrl(data?.web_logo_dark_path),
      resolveBrandingUrl(data?.pdf_logo_path),
      resolveBrandingUrl(data?.favicon_path),
    ]);
  const webLogoUrl = webLogoUrlExplicit || webLogoUrlSigned;
  const webLogoLightUrl = webLogoLightUrlExplicit || webLogoLightUrlSigned;
  const webLogoDarkUrl = webLogoDarkUrlExplicit || webLogoDarkUrlSigned;
  return {
    appName: data?.app_name ?? null,
    faviconPath: data?.favicon_path ?? null,
    webLogoPath: data?.web_logo_path ?? null,
    pdfLogoPath: data?.pdf_logo_path ?? null,
    webLogoLightPath: data?.web_logo_light_path ?? null,
    webLogoDarkPath: data?.web_logo_dark_path ?? null,
    faviconUrlExplicit,
    webLogoUrlExplicit,
    pdfLogoUrlExplicit,
    webLogoLightUrlExplicit,
    webLogoDarkUrlExplicit,
    faviconUrl: faviconUrlExplicit || faviconUrlSigned,
    webLogoUrl,
    pdfLogoUrl: pdfLogoUrlExplicit || pdfLogoUrlSigned,
    // Theme-aware web logos. Fall back to the themeless logo when only one
    // variant is configured.
    webLogoLightUrl: webLogoLightUrl || webLogoUrl,
    webLogoDarkUrl: webLogoDarkUrl || webLogoUrl,
  };
});

function requireAdmin(isAdmin: boolean) {
  if (!isAdmin) throw new Response("Forbidden — admin only", { status: 403 });
}

const UrlOrEmpty = z
  .string()
  .trim()
  .max(2000)
  .url("Must be a valid URL")
  .or(z.literal(""))
  .nullable()
  .optional();

const BrandingInput = z.object({
  appName: z.string().max(60).nullable().optional(),
  faviconPath: z.string().max(500).nullable().optional(),
  webLogoPath: z.string().max(500).nullable().optional(),
  pdfLogoPath: z.string().max(500).nullable().optional(),
  webLogoLightPath: z.string().max(500).nullable().optional(),
  webLogoDarkPath: z.string().max(500).nullable().optional(),
  faviconUrl: UrlOrEmpty,
  webLogoUrl: UrlOrEmpty,
  pdfLogoUrl: UrlOrEmpty,
  webLogoLightUrl: UrlOrEmpty,
  webLogoDarkUrl: UrlOrEmpty,
});

export const setBranding = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => BrandingInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    requireAdmin(isAdmin);
    const norm = (v: string | null | undefined) =>
      v === undefined ? undefined : v === "" ? null : v;
    const faviconUrl = norm(data.faviconUrl ?? undefined);
    const webLogoUrl = norm(data.webLogoUrl ?? undefined);
    const pdfLogoUrl = norm(data.pdfLogoUrl ?? undefined);
    const webLogoLightUrl = norm(data.webLogoLightUrl ?? undefined);
    const webLogoDarkUrl = norm(data.webLogoDarkUrl ?? undefined);
    await db.query(
      `insert into public.branding_settings
         (id, app_name, favicon_path, web_logo_path, pdf_logo_path,
          favicon_url, web_logo_url, pdf_logo_url,
          web_logo_light_path, web_logo_dark_path,
          web_logo_light_url,  web_logo_dark_url,
          updated_at, updated_by)
       values (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), $12)
       on conflict (id) do update set
         app_name             = case when $13 then $1  else public.branding_settings.app_name end,
         favicon_path         = case when $14 then $2  else public.branding_settings.favicon_path end,
         web_logo_path        = case when $15 then $3  else public.branding_settings.web_logo_path end,
         pdf_logo_path        = case when $16 then $4  else public.branding_settings.pdf_logo_path end,
         favicon_url          = case when $17 then $5  else public.branding_settings.favicon_url end,
         web_logo_url         = case when $18 then $6  else public.branding_settings.web_logo_url end,
         pdf_logo_url         = case when $19 then $7  else public.branding_settings.pdf_logo_url end,
         web_logo_light_path  = case when $20 then $8  else public.branding_settings.web_logo_light_path end,
         web_logo_dark_path   = case when $21 then $9  else public.branding_settings.web_logo_dark_path end,
         web_logo_light_url   = case when $22 then $10 else public.branding_settings.web_logo_light_url end,
         web_logo_dark_url    = case when $23 then $11 else public.branding_settings.web_logo_dark_url end,
         updated_at           = now(),
         updated_by           = $12`,
      [
        data.appName ?? null,
        data.faviconPath ?? null,
        data.webLogoPath ?? null,
        data.pdfLogoPath ?? null,
        faviconUrl ?? null,
        webLogoUrl ?? null,
        pdfLogoUrl ?? null,
        data.webLogoLightPath ?? null,
        data.webLogoDarkPath ?? null,
        webLogoLightUrl ?? null,
        webLogoDarkUrl ?? null,
        userId,
        data.appName !== undefined,
        data.faviconPath !== undefined,
        data.webLogoPath !== undefined,
        data.pdfLogoPath !== undefined,
        data.faviconUrl !== undefined,
        data.webLogoUrl !== undefined,
        data.pdfLogoUrl !== undefined,
        data.webLogoLightPath !== undefined,
        data.webLogoDarkPath !== undefined,
        data.webLogoLightUrl !== undefined,
        data.webLogoDarkUrl !== undefined,
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
    const { userId, isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
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
    const { isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    requireAdmin(isAdmin);
    return db.many(
      "select * from public.invite_codes order by created_at desc limit 200",
    );
  });

export const revokeInviteCode = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
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
