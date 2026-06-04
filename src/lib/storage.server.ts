// S3-compatible object storage layer.
// Replaces Supabase Storage. Uses a single bucket; the legacy bucket name is
// stored as a folder prefix (raw-runs/, reports/, branding/, avatars/).
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION || "us-east-1";
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const bucket = process.env.S3_BUCKET;
const publicBase = process.env.S3_PUBLIC_URL_BASE; // optional CDN/base URL

if (!bucket) console.warn("[storage] S3_BUCKET is not set");

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

/** Presigned PUT URL the browser uses to upload directly to S3. */
export async function createSignedUploadUrl(
  b: BucketName,
  path: string,
  contentType = "application/octet-stream",
  expiresInSeconds = 60 * 15,
): Promise<{ url: string; key: string }> {
  const key = objectKey(b, path);
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
  const cmd = new GetObjectCommand({
    Bucket: BUCKET,
    Key: objectKey(b, path),
  });
  return getSignedUrl(s3, cmd, { expiresIn: expiresInSeconds });
}

/** Public URL for buckets that are exposed via CDN. */
export function publicUrl(b: BucketName, path: string | null | undefined): string | null {
  if (!path) return null;
  const key = objectKey(b, path);
  if (publicBase) return `${publicBase.replace(/\/+$/, "")}/${key}`;
  if (endpoint) return `${endpoint.replace(/\/+$/, "")}/${BUCKET}/${key}`;
  return `https://${BUCKET}.s3.${region}.amazonaws.com/${key}`;
}

/** Server-side download (used for parsing EIC blobs). */
export async function downloadObject(b: BucketName, path: string): Promise<Uint8Array> {
  const out = await s3.send(new GetObjectCommand({
    Bucket: BUCKET,
    Key: objectKey(b, path),
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
    for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
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
  await s3
    .send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: paths.map((p) => ({ Key: objectKey(b, p) })) },
    }))
    .catch(() => undefined);
}
