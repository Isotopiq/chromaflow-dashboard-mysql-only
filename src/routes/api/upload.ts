// Local-mode file upload endpoint.
//
// When S3 is not configured, createSignedUploadUrl returns a URL pointing
// here with a signed token. The browser PUTs the file body to this endpoint,
// and we store it on the local filesystem.
import { createFileRoute } from "@tanstack/react-router";
import { verifyUploadToken, localPut, localPutChunk } from "@/lib/storage.server";

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

        // Chunked upload support — the desktop companion sends large files
        // in multiple PUTs carrying ?offset=<bytes>&total=<bytes>. Each
        // chunk is small enough to fit inside reverse-proxy timeouts.
        const offset = url.searchParams.get("offset");
        const total = url.searchParams.get("total");
        const isChunked = offset !== null && total !== null;

        // Limit to 500 MB for raw run uploads; 25 MB for branding/favicon.
        const body = await request.arrayBuffer();
        const isRawRun = decoded.key.startsWith("raw-runs/");
        const maxSize = isRawRun ? 500 * 1024 * 1024 : 25 * 1024 * 1024;
        const effectiveSize = isChunked ? Number(total) : body.byteLength;
        if (effectiveSize > maxSize) {
          return Response.json({ error: `File too large (max ${isRawRun ? "500" : "25"} MB)` }, { status: 413 });
        }

        try {
          if (isChunked) {
            const off = Number(offset);
            const tot = Number(total);
            const isFinal = off + body.byteLength >= tot;
            await localPutChunk(decoded.key, new Uint8Array(body), decoded.contentType, off, isFinal);
            return Response.json({ ok: true, key: decoded.key, received: off + body.byteLength });
          }
          await localPut(decoded.key, new Uint8Array(body), decoded.contentType);
          return Response.json({ ok: true, key: decoded.key });
        } catch (e: any) {
          console.error("[upload] local put failed:", e?.message);
          return Response.json({ error: "Upload failed" }, { status: 500 });
        }
      },
    },
  },
});
