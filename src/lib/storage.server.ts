// S3-compatible object storage layer with local filesystem fallback.
//
// Configuration precedence (highest to lowest):
//   1. Database (storage_settings table — set via admin UI)
//   2. Environment variables (S3_BUCKET, S3_ENDPOINT, etc.)
//
// When no bucket is configured via either source, files are stored on the
// local filesystem under LOCAL_STORAGE_DIR and served by the app itself.
//
// Uses a single bucket; the legacy bucket name is stored as a folder prefix
// (raw-runs/, reports/, branding/, avatars/).
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

// AWS SDK imports are deferred to runtime so Rollup does not bundle the
// entire SDK into the Nitro server when S3 is not configured (the common
// case for self-hosted / Easypanel deployments). This dramatically reduces
// build time and bundle size.
type S3ClientLike = {
  send: (cmd: unknown) => Promise<{ Body?: unknown }>;
};
type S3ClientCtor = new (opts: unknown) => S3ClientLike;

// ---- Resolved storage configuration ----
interface StorageConfig {
  bucket: string | null;
  endpoint: string | null;
  region: string;
  accessKeyId: string | null;
  secretAccessKey: string | null;
  publicBase: string | null;
  forcePathStyle: boolean;
}

// ---- Env-var defaults (read once at module load) ----
const ENV = {
  endpoint: process.env.S3_ENDPOINT || null,
  region: process.env.S3_REGION || "us-east-1",
  accessKeyId: process.env.S3_ACCESS_KEY_ID || null,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || null,
  bucket: process.env.S3_BUCKET || null,
  publicBase: process.env.S3_PUBLIC_URL_BASE || null,
  forcePathStyle:
    (process.env.S3_FORCE_PATH_STYLE ?? "").toLowerCase() === "true",
};

// ---- Config cache ----
// The resolved config is cached in-process and re-read from the DB when:
//   - the cache is empty (first use)
//   - invalidateStorageCache() is called (after admin saves new settings)
let _configPromise: Promise<StorageConfig> | null = null;

/** Read storage settings from the DB (admin overrides) and merge with env vars. */
async function loadConfigFromDB(): Promise<Partial<StorageConfig>> {
  try {
    // Dynamic import to avoid circular dependency at module load time.
    const { withAdmin } = await import("@/db/index.server");
    const row = await withAdmin((db) =>
      db.maybe<any>("select * from public.storage_settings where id = 1"),
    );
    if (!row) return {};
    const trim = (v: any) => (typeof v === "string" ? v.trim() || null : null);
    return {
      bucket: trim(row.s3_bucket),
      endpoint: trim(row.s3_endpoint),
      region: trim(row.s3_region) ?? undefined,
      accessKeyId: trim(row.s3_access_key_id),
      secretAccessKey: trim(row.s3_secret_access_key),
      publicBase: trim(row.s3_public_url_base),
      forcePathStyle: row.s3_force_path_style ?? undefined,
    };
  } catch {
    // DB not ready or table doesn't exist yet — fall back to env only.
    return {};
  }
}

/** Resolve the effective storage configuration (DB overrides env). */
export async function resolveStorageConfig(): Promise<StorageConfig> {
  if (!_configPromise) {
    _configPromise = (async () => {
      const db = await loadConfigFromDB();
      const cfg: StorageConfig = {
        bucket: db.bucket ?? ENV.bucket,
        endpoint: db.endpoint ?? ENV.endpoint,
        region: db.region ?? ENV.region,
        accessKeyId: db.accessKeyId ?? ENV.accessKeyId,
        secretAccessKey: db.secretAccessKey ?? ENV.secretAccessKey,
        publicBase: db.publicBase ?? ENV.publicBase,
        forcePathStyle: db.forcePathStyle ?? ENV.forcePathStyle,
      };
      if (!cfg.bucket) {
        console.info(
          `[storage] No bucket configured — using local filesystem at ${LOCAL_STORAGE_DIR}`,
        );
      }
      return cfg;
    })();
  }
  return _configPromise;
}

/**
 * Invalidate the cached storage config + S3 client. Called after admin
 * saves new storage settings so the next operation picks up the changes.
 */
export function invalidateStorageCache(): void {
  _configPromise = null;
  globalThis.__chromaS3Client = undefined;
  _s3Promise = null;
}

// ---- Local filesystem fallback ----
export const LOCAL_STORAGE_DIR =
  process.env.LOCAL_STORAGE_DIR || "/app/data/uploads";

/**
 * Synchronous check using env vars only. Used for the initial log line and
 * for code paths that haven't been converted to async yet. The async
 * `resolveStorageConfig()` is the source of truth at runtime.
 */
export const usingLocalStorage = !ENV.bucket;

if (usingLocalStorage) {
  console.info(
    `[storage] S3_BUCKET env not set — will check DB settings on first use (local fallback: ${LOCAL_STORAGE_DIR})`,
  );
}

declare global {
  // eslint-disable-next-line no-var
  var __chromaS3Client: S3ClientLike | undefined;
}

let _s3Promise: Promise<S3ClientLike> | null = null;

/** Lazily create (and cache) the S3 client using the resolved config. */
async function getS3(): Promise<S3ClientLike> {
  if (globalThis.__chromaS3Client) return globalThis.__chromaS3Client;
  if (_s3Promise) return _s3Promise;
  _s3Promise = (async () => {
    const cfg = await resolveStorageConfig();
    const { S3Client } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: cfg.region || "us-east-1",
      endpoint: cfg.endpoint || undefined,
      forcePathStyle: cfg.forcePathStyle,
      credentials:
        cfg.accessKeyId && cfg.secretAccessKey
          ? { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
          : undefined,
    }) as unknown as S3ClientLike;
    globalThis.__chromaS3Client = client;
    return client;
  })();
  return _s3Promise;
}

/** Lazily import AWS SDK command classes + presigner only when needed. */
async function getS3Commands() {
  const [
    { GetObjectCommand, PutObjectCommand, DeleteObjectsCommand },
    { getSignedUrl },
  ] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);
  return { GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, getSignedUrl };
}

/** Resolve the bucket name from the effective config. */
async function getBucket(): Promise<string> {
  const cfg = await resolveStorageConfig();
  return cfg.bucket ?? "";
}

/** Resolve whether local storage is in effect (no bucket configured). */
async function isLocal(): Promise<boolean> {
  const cfg = await resolveStorageConfig();
  return !cfg.bucket;
}

export const BUCKET = ENV.bucket ?? "";

export type BucketName = "raw-runs" | "reports" | "branding" | "avatars";

function objectKey(b: BucketName, path: string): string {
  // Strip leading slashes from path; bucket becomes folder prefix.
  return `${b}/${path.replace(/^\/+/, "")}`;
}

// ---- Local filesystem helpers ----

function localPath(key: string): string {
  return join(LOCAL_STORAGE_DIR, key);
}

/** Ensure the parent directory exists for a local file. */
async function ensureDir(filePath: string): Promise<void> {
  await fs.mkdir(join(filePath, ".."), { recursive: true });
}

/**
 * Generate a short HMAC-signed token for local upload URLs so only the app
 * can initiate uploads (not arbitrary external callers).
 */
function signUploadToken(key: string, contentType: string): string {
  const secret = process.env.JWT_SECRET || "local-storage-dev-key";
  const raw = `${key}|${contentType}|${Math.floor(Date.now() / 1000 / 300)}`; // 5-min window
  const sig = createHash("sha256").update(`${raw}:${secret}`).digest("hex").slice(0, 32);
  return Buffer.from(`${raw}:${sig}`).toString("base64url");
}

/** Verify a token produced by signUploadToken. */
export function verifyUploadToken(token: string): { key: string; contentType: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    // Format: "key|contentType|ts:sig" — split signature off the back,
    // then split the data on "|".
    const lastColon = decoded.lastIndexOf(":");
    if (lastColon < 0) return null;
    const data = decoded.slice(0, lastColon);
    const sig = decoded.slice(lastColon + 1);
    const parts = data.split("|");
    if (parts.length !== 3) return null;
    const [key, contentType, tsStr] = parts;
    if (!key || !contentType || !tsStr) return null;
    const secret = process.env.JWT_SECRET || "local-storage-dev-key";
    const expected = createHash("sha256")
      .update(`${data}:${secret}`)
      .digest("hex")
      .slice(0, 32);
    if (sig !== expected) return null;
    // Accept any token within the current or previous 5-min window.
    const now = Math.floor(Date.now() / 1000 / 300);
    const ts = parseInt(tsStr, 10);
    if (Math.abs(now - ts) > 1) return null;
    return { key, contentType };
  } catch {
    return null;
  }
}

/** Store a file body to the local filesystem. */
export async function localPut(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const fp = localPath(key);
  await ensureDir(fp);
  await fs.writeFile(fp, body);
  // Sidecar .meta file with content-type for serving later.
  await fs.writeFile(`${fp}.meta`, contentType, "utf8");
}

// ---- Public API (works for both S3 and local) ----

/** Presigned PUT URL the browser uses to upload directly to S3. */
export async function createSignedUploadUrl(
  b: BucketName,
  path: string,
  contentType = "application/octet-stream",
  expiresInSeconds = 60 * 15,
): Promise<{ url: string; key: string }> {
  const key = objectKey(b, path);

  if (await isLocal()) {
    // Return an app-internal upload endpoint URL with a signed token.
    const token = signUploadToken(key, contentType);
    return {
      url: `/api/upload?token=${encodeURIComponent(token)}`,
      key,
    };
  }

  const { PutObjectCommand, getSignedUrl } = await getS3Commands();
  const client = await getS3();
  const bucket = await getBucket();
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(client as any, cmd, { expiresIn: expiresInSeconds });
  return { url, key };
}

/** Presigned GET URL for private downloads (reports, raw-runs, etc.). */
export async function createSignedDownloadUrl(
  b: BucketName,
  path: string,
  expiresInSeconds = 60 * 10,
): Promise<string> {
  const key = objectKey(b, path);

  if (await isLocal()) {
    // Local files are served by the app directly — no signing needed since
    // the app controls access. Return the internal serve URL.
    return `/api/asset?key=${encodeURIComponent(key)}`;
  }

  // S3 mode: try S3 first, fall back to local filesystem if the object
  // doesn't exist (e.g. files uploaded before S3 was configured).
  try {
    const { GetObjectCommand, getSignedUrl } = await getS3Commands();
    const client = await getS3();
    const bucket = await getBucket();
    const cmd = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return await getSignedUrl(client as any, cmd, { expiresIn: expiresInSeconds });
  } catch {
    // S3 presign failed — check if the file exists locally as a fallback.
    const fp = localPath(key);
    try {
      await fs.access(fp);
      return `/api/asset?key=${encodeURIComponent(key)}`;
    } catch {
      // Not in local either — return a placeholder that will 404.
      return `/api/asset?key=${encodeURIComponent(key)}`;
    }
  }
}

/** Public URL for buckets that are exposed via CDN. */
export async function publicUrl(b: BucketName, path: string | null | undefined): Promise<string | null> {
  if (!path) return null;
  const key = objectKey(b, path);

  if (await isLocal()) {
    return `/api/asset?key=${encodeURIComponent(key)}`;
  }

  const cfg = await resolveStorageConfig();
  const bucket = cfg.bucket ?? "";
  if (cfg.publicBase) return `${cfg.publicBase.replace(/\/+$/, "")}/${key}`;
  if (cfg.endpoint) return `${cfg.endpoint.replace(/\/+$/, "")}/${bucket}/${key}`;
  return `https://${bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
}

/** Synchronous publicUrl using env-only config (for backward compat). */
export function publicUrlSync(b: BucketName, path: string | null | undefined): string | null {
  if (!path) return null;
  const key = objectKey(b, path);
  if (!ENV.bucket) return `/api/asset?key=${encodeURIComponent(key)}`;
  if (ENV.publicBase) return `${ENV.publicBase.replace(/\/+$/, "")}/${key}`;
  if (ENV.endpoint) return `${ENV.endpoint.replace(/\/+$/, "")}/${ENV.bucket}/${key}`;
  return `https://${ENV.bucket}.s3.${ENV.region}.amazonaws.com/${key}`;
}

/** Server-side download (used for parsing EIC blobs). */
export async function downloadObject(b: BucketName, path: string): Promise<Uint8Array> {
  const key = objectKey(b, path);

  if (await isLocal()) {
    return fs.readFile(localPath(key));
  }

  const { GetObjectCommand } = await getS3Commands();
  const client = await getS3();
  const bucket = await getBucket();
  const out = await client.send(new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
  const body = out.Body as any;
  if (!body) return new Uint8Array();
  if (body instanceof Uint8Array) return body;
  if (typeof body.transformToByteArray === "function") {
    return body.transformToByteArray();
  }
  if (typeof body.arrayBuffer === "function") {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
      chunks.push(bytes);
      total += bytes.byteLength;
    }
    const result = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { result.set(c, off); off += c.byteLength; }
    return result;
  }
  if (typeof body.getReader !== "function") {
    throw new Error("Storage download returned an unsupported response body.");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) { chunks.push(value); total += value.byteLength; }
  }
  const result = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { result.set(c, off); off += c.byteLength; }
  return result;
}

/** Best-effort bulk delete; never throws on missing keys. */
export async function removeObjects(b: BucketName, paths: string[]): Promise<void> {
  if (paths.length === 0) return;

  if (await isLocal()) {
    for (const p of paths) {
      const key = objectKey(b, p);
      await fs.unlink(localPath(key)).catch(() => undefined);
      await fs.unlink(`${localPath(key)}.meta`).catch(() => undefined);
    }
    return;
  }

  const { DeleteObjectsCommand } = await getS3Commands();
  const client = await getS3();
  const bucket = await getBucket();
  await client
    .send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: paths.map((p) => ({ Key: objectKey(b, p) })) },
    }))
    .catch(() => undefined);
}
