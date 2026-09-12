// Local-mode file upload endpoint.
//
// When S3 is not configured, createSignedUploadUrl returns a URL pointing
// here with a signed token. The browser PUTs the file body to this endpoint,
// and we store it on the local filesystem.
import { createFileRoute } from "@tanstack/react-router";
import { verifyUploadToken, localPutChunk, localPutStream } from "@/lib/storage.server";

const MAX_CHUNK = 32 * 1024 * 1024; // 32 MB per chunk
const MAX_RAW_RUN = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_OTHER = 100 * 1024 * 1024; // 100 MB

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token");
        if (!token) {
          return Response.json({ error: "Missing upload token" }, { status: 400 });
        }
        const decoded = verifyUploadToken(token);
        if (!decoded) {
          return Response.json({ error: "Invalid or expired upload token" }, { status: 403 });
        }

        const isRawRun = decoded.key.startsWith("raw-runs/");
        const maxSize = isRawRun ? MAX_RAW_RUN : MAX_OTHER;

        // Chunked upload support — the desktop companion sends large files
        // in multiple PUTs carrying ?offset=<bytes>&total=<bytes>. Each
        // chunk is small enough to fit inside reverse-proxy timeouts.
        const offset = url.searchParams.get("offset");
        const total = url.searchParams.get("total");
        const isChunked = offset !== null && total !== null;

        try {
          if (isChunked) {
            const off = Number(offset);
            const tot = Number(total);
            if (!Number.isInteger(off) || !Number.isInteger(tot) || off < 0 || tot <= 0) {
              return Response.json({ error: "Invalid chunk offset/total" }, { status: 400 });
            }
            if (tot > maxSize) {
              return Response.json(
                { error: `File too large (max ${isRawRun ? "2048" : "100"} MB)` },
                { status: 413 },
              );
            }
            const body = await request.arrayBuffer();
            if (body.byteLength === 0) {
              return Response.json({ error: "Empty chunk" }, { status: 400 });
            }
            if (body.byteLength > MAX_CHUNK) {
              return Response.json({ error: `Chunk too large (max ${MAX_CHUNK / 1024 / 1024} MB)` }, { status: 413 });
            }
            if (off + body.byteLength > tot) {
              return Response.json({ error: "Chunk exceeds declared total size" }, { status: 400 });
            }
            await localPutChunk(decoded.key, new Uint8Array(body), decoded.contentType, off, tot);
            return Response.json({ ok: true, key: decoded.key, received: off + body.byteLength });
          }

          // Non-chunked upload — stream to disk so large files do not exhaust memory.
          const contentLength = Number(request.headers.get("content-length") ?? 0);
          if (contentLength > maxSize) {
            return Response.json(
              { error: `File too large (max ${isRawRun ? "2048" : "100"} MB)` },
              { status: 413 },
            );
          }
          await localPutStream(decoded.key, request.body, decoded.contentType, maxSize);
          return Response.json({ ok: true, key: decoded.key });
        } catch (e: any) {
          const msg = e?.message ?? "Upload failed";
          console.error("[upload] local put failed:", msg);
          const status = /out of order|Invalid chunk|exceeds declared|too large|Empty chunk/i.test(msg) ? 400 : 500;
          return Response.json({ error: msg }, { status });
        }
      },
    },
  },
});
