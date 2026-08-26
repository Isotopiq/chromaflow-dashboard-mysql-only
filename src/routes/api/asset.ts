// Local-mode asset serving endpoint.
//
// When S3 is not configured, stored files are served from the local
// filesystem via this route: GET /api/asset?key=branding/userId/file.png
import { createFileRoute } from "@tanstack/react-router";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { LOCAL_STORAGE_DIR } from "@/lib/storage.server";
import { resolveStorageConfig } from "@/lib/storage.server";

// Allowlist of content types for common image/favicon formats.
function contentTypeFor(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    pdf: "application/pdf",
    json: "application/json",
    txt: "text/plain",
    csv: "text/csv",
    mzml: "application/xml",
    xml: "application/xml",
  };
  return map[ext] ?? "application/octet-stream";
}

export const Route = createFileRoute("/api/asset")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cfg = await resolveStorageConfig();
        if (cfg.bucket) {
          return Response.json({ error: "Local storage is not enabled" }, { status: 400 });
        }
        const url = new URL(request.url);
        const key = url.searchParams.get("key");
        if (!key) {
          return Response.json({ error: "Missing key" }, { status: 400 });
        }
        // Prevent path traversal — the key must not contain "..".
        if (key.includes("..")) {
          return Response.json({ error: "Invalid key" }, { status: 400 });
        }
        const filePath = join(LOCAL_STORAGE_DIR, key);
        try {
          const data = await fs.readFile(filePath);
          // Try reading the sidecar .meta file for the exact content type
          // that was set during upload; fall back to extension-based guess.
          let ct = "";
          try {
            ct = await fs.readFile(`${filePath}.meta`, "utf8");
          } catch {
            ct = contentTypeFor(key);
          }
          return new Response(data, {
            status: 200,
            headers: {
              "content-type": ct,
              "cache-control": "public, max-age=3600",
            },
          });
        } catch {
          return Response.json({ error: "File not found" }, { status: 404 });
        }
      },
    },
  },
});
