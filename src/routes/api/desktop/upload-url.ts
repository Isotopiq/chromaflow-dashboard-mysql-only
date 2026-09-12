// Desktop companion upload URL endpoint.
// Returns a presigned PUT URL for uploading files to V3 storage (S3 or local).
// Mirrors the createUploadUrl server fn.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearerAuth } from "@/lib/desktop-auth";
import { createSignedUploadUrl, type BucketName } from "@/lib/storage.server";

const Body = z.object({
  filename: z.string().min(1).max(300),
  bucket: z.enum(["raw-runs", "reports", "branding", "avatars"]).default("raw-runs"),
  suffix: z.string().max(40).optional(),
  contentType: z.string().max(120).optional(),
});

export const Route = createFileRoute("/api/desktop/upload-url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          return await requireBearerAuth(request, async (ctx) => {
            let parsed;
            try {
              parsed = Body.parse(await request.json());
            } catch {
              return Response.json({ error: "Invalid request body" }, { status: 400 });
            }
            const safe = parsed.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
            const stamp = Date.now();
            const path = `${ctx.userId}/${stamp}-${safe}${parsed.suffix ?? ""}`;
            const { url } = await createSignedUploadUrl(
              parsed.bucket as BucketName,
              path,
              parsed.contentType ?? "application/octet-stream",
            );
            // `path` is the key within the bucket (no prefix) — matches the
            // browser createUploadUrl server fn so file_path/scans_blob_path
            // stored on runs work with downloadObject("raw-runs", path).
            return Response.json({ signedUrl: url, path, bucket: parsed.bucket });
          });
        } catch (e: any) {
          if (e instanceof Response) return e;
          return Response.json({ error: e?.message ?? "Failed to create upload URL" }, { status: 500 });
        }
      },
    },
  },
});
