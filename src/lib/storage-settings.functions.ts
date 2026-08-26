import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import { withAdmin } from "@/db/index.server";

function requireAdmin(isAdmin: boolean) {
  if (!isAdmin) throw new Response("Forbidden — admin only", { status: 403 });
}

// ---- Get current storage settings (admin only) ----
// Returns the DB-stored settings merged with env-var fallbacks so the admin
// can see the effective configuration. Secrets are masked.
export const getStorageSettings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { isAdmin } = context as { isAdmin: boolean };
    requireAdmin(isAdmin);

    let row: any = null;
    try {
      row = await withAdmin((db) =>
        db.maybe<any>("select * from public.storage_settings where id = 1"),
      );
    } catch (e) {
      console.warn("[storage-settings] DB read failed:", (e as Error)?.message);
    }

    // Effective values: DB overrides env, env is the fallback.
    const dbBucket = (row?.s3_bucket ?? "").trim() || null;
    const dbEndpoint = (row?.s3_endpoint ?? "").trim() || null;
    const dbRegion = (row?.s3_region ?? "").trim() || null;
    const dbAccessKey = (row?.s3_access_key_id ?? "").trim() || null;
    const dbSecretKey = (row?.s3_secret_access_key ?? "").trim() || null;
    const dbPublicBase = (row?.s3_public_url_base ?? "").trim() || null;
    const dbForcePathStyle = row?.s3_force_path_style ?? null;

    const envBucket = (process.env.S3_BUCKET ?? "").trim() || null;
    const envEndpoint = (process.env.S3_ENDPOINT ?? "").trim() || null;
    const envRegion = (process.env.S3_REGION ?? "").trim() || null;
    const envAccessKey = (process.env.S3_ACCESS_KEY_ID ?? "").trim() || null;
    const envSecretKey = (process.env.S3_SECRET_ACCESS_KEY ?? "").trim() || null;
    const envPublicBase = (process.env.S3_PUBLIC_URL_BASE ?? "").trim() || null;
    const envForcePathStyle =
      (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true";

    const effectiveBucket = dbBucket ?? envBucket;
    const effectiveEndpoint = dbEndpoint ?? envEndpoint;
    const effectiveRegion = dbRegion ?? envRegion;
    const effectiveAccessKey = dbAccessKey ?? envAccessKey;
    const effectiveSecretKey = dbSecretKey ?? envSecretKey;
    const effectivePublicBase = dbPublicBase ?? envPublicBase;
    const effectiveForcePathStyle = dbForcePathStyle ?? envForcePathStyle;

    // Mask secrets: show only whether set, plus last 4 chars.
    const mask = (v: string | null) => {
      if (!v) return null;
      if (v.length <= 8) return "••••";
      return `••••${v.slice(-4)}`;
    };

    return {
      // Effective (resolved) config
      effective: {
        bucket: effectiveBucket,
        endpoint: effectiveEndpoint,
        region: effectiveRegion,
        accessKeyId: mask(effectiveAccessKey),
        secretAccessKey: mask(effectiveSecretKey),
        publicUrlBase: effectivePublicBase,
        forcePathStyle: effectiveForcePathStyle,
        usingLocalStorage: !effectiveBucket,
        localStorageDir: process.env.LOCAL_STORAGE_DIR || "/app/data/uploads",
      },
      // DB-stored values (what the admin explicitly set via UI)
      // Secrets are masked for display; the raw values are never sent to the client.
      db: {
        bucket: dbBucket,
        endpoint: dbEndpoint,
        region: dbRegion,
        accessKeyId: mask(dbAccessKey),
        secretAccessKey: mask(dbSecretKey),
        publicUrlBase: dbPublicBase,
        forcePathStyle: dbForcePathStyle,
      },
      // Env-var fallback values (read-only, for reference)
      env: {
        bucket: envBucket,
        endpoint: envEndpoint,
        region: envRegion,
        accessKeyId: mask(envAccessKey),
        secretAccessKey: mask(envSecretKey),
        publicUrlBase: envPublicBase,
        forcePathStyle: envForcePathStyle,
      },
    };
  });

// ---- Save storage settings (admin only) ----
// Empty strings clear the DB override so the env var fallback is used.
// Secrets: if the submitted value matches the mask pattern (starts with ••••),
// the existing DB value is preserved (admin didn't change it).
const StorageSettingsInput = z.object({
  bucket: z.string().max(200).nullable().optional(),
  endpoint: z.string().max(500).nullable().optional(),
  region: z.string().max(100).nullable().optional(),
  accessKeyId: z.string().max(200).nullable().optional(),
  secretAccessKey: z.string().max(200).nullable().optional(),
  publicUrlBase: z.string().max(500).nullable().optional(),
  forcePathStyle: z.boolean().optional(),
});

export const setStorageSettings = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => StorageSettingsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, isAdmin, db } = context as {
      userId: string;
      isAdmin: boolean;
      db: import("@/db/index.server").Db;
    };
    requireAdmin(isAdmin);

    // Normalize: empty string -> null (clear override), undefined -> keep existing.
    const norm = (v: string | null | undefined) =>
      v === undefined ? undefined : v === "" ? null : v;

    const bucket = norm(data.bucket);
    const endpoint = norm(data.endpoint);
    const region = norm(data.region);
    const publicUrlBase = norm(data.publicUrlBase);
    const forcePathStyle = data.forcePathStyle;

    // For secrets: if the value looks like a mask (••••), preserve the existing DB value.
    const isMasked = (v: string | null | undefined) =>
      typeof v === "string" && v.startsWith("••••");

    let accessKeyId = norm(data.accessKeyId);
    let secretAccessKey = norm(data.secretAccessKey);

    // Fetch existing secrets so we can preserve them when masked.
    if (isMasked(data.accessKeyId) || isMasked(data.secretAccessKey)) {
      const existing = await db.maybe<any>(
        "select s3_access_key_id, s3_secret_access_key from public.storage_settings where id = 1",
      );
      if (isMasked(data.accessKeyId)) accessKeyId = existing?.s3_access_key_id ?? null;
      if (isMasked(data.secretAccessKey)) secretAccessKey = existing?.s3_secret_access_key ?? null;
    }

    // Build the SET clause dynamically so undefined fields are preserved.
    const sets: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    const addField = (col: string, val: any) => {
      if (val === undefined) return;
      sets.push(`${col} = $${pIdx}`);
      params.push(val);
      pIdx++;
    };

    addField("s3_bucket", bucket);
    addField("s3_endpoint", endpoint);
    addField("s3_region", region);
    addField("s3_access_key_id", accessKeyId);
    addField("s3_secret_access_key", secretAccessKey);
    addField("s3_public_url_base", publicUrlBase);
    if (forcePathStyle !== undefined) addField("s3_force_path_style", forcePathStyle);
    addField("updated_at", new Date().toISOString());
    addField("updated_by", userId);

    if (sets.length > 0) {
      await db.query(
        `insert into public.storage_settings (id) values (1)
         on conflict (id) do update set ${sets.join(", ")}`,
        params,
      );
    }

    // Invalidate the in-process S3 client cache so new settings take effect.
    const { invalidateStorageCache } = await import("@/lib/storage.server");
    invalidateStorageCache();

    return { ok: true };
  });

// ---- Test S3 connection (admin only) ----
// Attempts to list objects in the bucket to verify credentials.
export const testStorageConnection = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { isAdmin } = context as { isAdmin: boolean };
    requireAdmin(isAdmin);

    // Reload settings from DB + env, then try to create a client and list.
    const { resolveStorageConfig } = await import("@/lib/storage.server");
    const cfg = await resolveStorageConfig();

    if (!cfg.bucket) {
      return { ok: false as const, reason: "No bucket configured — using local filesystem." };
    }

    try {
      const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const client = new S3Client({
        region: cfg.region || "us-east-1",
        endpoint: cfg.endpoint || undefined,
        forcePathStyle: cfg.forcePathStyle,
        credentials:
          cfg.accessKeyId && cfg.secretAccessKey
            ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
            : undefined,
      });
      const result = await client.send(
        new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1 }),
      );
      return {
        ok: true as const,
        keyCount: result.KeyCount ?? 0,
        region: cfg.region,
        endpoint: cfg.endpoint || "(AWS default)",
      };
    } catch (e: any) {
      return { ok: false as const, reason: e?.message ?? "Connection failed" };
    }
  });
