// Local-mode file upload endpoint.
//
// When S3 is not configured, createSignedUploadUrl returns a URL pointing
// here with a signed token. The browser PUTs the file body to this endpoint,
// and we store it on the local filesystem.
import { createFileRoute } from "@tanstack/react-router";
import { verifyUploadToken, localPut } from "@/lib/storage.server";

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
        // Limit to 25 MB for branding/favicon uploads.
        const body = await request.arrayBuffer();
        if (body.byteLength > 25 * 1024 * 1024) {
          return Response.json({ error: "File too large (max 25 MB)" }, { status: 413 });
        }
        try {
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
