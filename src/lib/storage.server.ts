// S3-compatible object storage layer with local filesystem fallback.
//
// When S3_BUCKET is set, all operations go to S3 (or any S3-compatible
// endpoint like R2 / MinIO). When S3_BUCKET is NOT set, files are stored on
// the local filesystem under LOCAL_STORAGE_DIR (default /app/data/uploads)
// and served by the app itself via /api/_uploads/* and /api/_upload.
//
// Uses a single bucket; the legacy bucket name is stored as a folder prefix
// (raw-runs/, reports/, branding/, avatars/).
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { join } from "node:path";

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION || "us-east-1";
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const bucket = process.env.S3_BUCKET;
const publicBase = process.env.S3_PUBLIC_URL_BASE; // optional CDN/base URL

// ---- Local filesystem fallback ----
export const LOCAL_STORAGE_DIR =
  process.env.LOCAL_STORAGE_DIR || "/app/data/uploads";
export const usingLocalStorage = !bucket;

if (usingLocalStorage) {
  console.info(
    `[storage] S3_BUCKET not set — using local filesystem at ${LOCAL_STORAGE_DIR}`,
  );
} else if (!bucket) {
  console.warn("[storage] S3_BUCKET is not set");
}

declare global {
  // eslint-disable-next-line no-var
  var __chromaS3Client: S3Client | undefined;
}

export const s3: S3Client =
  globalThis.__chromaS3Client ??
  (globalThis.__chromaS3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle: !!endpoint, // for MinIO / R2 / non-AWS S3 endpoints
    credentials:
      accessKeyId && secretAccessKey
        ? { accessKeyId, secretAccessKey }
        : undefined,
  }));

export const BUCKET = bucket ?? "";

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

  if (usingLocalStorage) {
    // Return an app-internal upload endpoint URL with a signed token.
    const token = signUploadToken(key, contentType);
    return {
      url: `/api/upload?token=${encodeURIComponent(token)}`,
      key,
    };
  }

  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
  return { url, key };
}

/** Presigned GET URL for private downloads (reports, raw-runs, etc.). */
export async function createSignedDownloadUrl(
  b: BucketName,
  path: string,
  expiresInSeconds = 60 * 10,
): Promise<string> {
  const key = objectKey(b, path);

  if (usingLocalStorage) {
    // Local files are served by the app directly — no signing needed since
    // the app controls access. Return the internal serve URL.
    return `/api/asset?key=${encodeURIComponent(key)}`;
  }

  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

/** Public URL for buckets that are exposed via CDN. */
export function publicUrl(b: BucketName, path: string | null | undefined): string | null {
  if (!path) return null;
  const key = objectKey(b, path);

  if (usingLocalStorage) {
    return `/api/asset?key=${encodeURIComponent(key)}`;
  }

  if (publicBase) return `${publicBase.replace(/\/+$/, "")}/${key}`;
  if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${BUCKET}/${key}`;
  return `https://${BUCKET}.s3.${region}.amazonaws.com/${key}`;
}

/** Server-side download (used for parsing EIC blobs). */
export async function downloadObject(b: BucketName, path: string): Promise<Uint8Array> {
  const key = objectKey(b, path);

  if (usingLocalStorage) {
    return fs.readFile(localPath(key));
  }

  const out = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
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

  if (usingLocalStorage) {
    for (const p of paths) {
      const key = objectKey(b, p);
      await fs.unlink(localPath(key)).catch(() => undefined);
      await fs.unlink(`${localPath(key)}.meta`).catch(() => undefined);
    }
    return;
  }

  await s3
    .send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: paths.map((p) => ({ Key: objectKey(b, p) })) },
    }))
    .catch(() => undefined);
}
