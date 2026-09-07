// Desktop companion watch-folders CRUD endpoint.
// GET: list all watch folders.
// POST: upsert (create or update) a watch folder.
// Mirrors the upsertWatchFolder server fn.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearerAuth } from "@/lib/desktop-auth";
import { mapImportWatchFolder } from "@/lib/lab-data.server";

const WatchFolderInput = z.object({
  id: z.string().uuid().optional(),
  path: z.string().min(1),
  enabled: z.boolean().default(true),
  methodId: z.string().uuid().nullable().optional(),
  columnId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  filePattern: z.string().default("*.mzXML"),
});

export const Route = createFileRoute("/api/desktop/watch-folders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let ctx;
        try {
          ctx = await requireBearerAuth(request);
        } catch (e: any) {
          return e instanceof Response ? e : Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        try {
          const rows = await ctx.db.many<any>(
            "select * from public.import_watch_folders order by created_at desc",
          );
          return Response.json(rows.map(mapImportWatchFolder));
        } catch {
          return Response.json([]);
        }
      },
      POST: async ({ request }) => {
        let ctx;
        try {
          ctx = await requireBearerAuth(request);
        } catch (e: any) {
          return e instanceof Response ? e : Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        let parsed;
        try {
          parsed = WatchFolderInput.parse(await request.json());
        } catch (e: any) {
          return Response.json({ error: "Invalid request body", details: e?.errors ?? e?.message }, { status: 400 });
        }
        try {
          if (parsed.id) {
            const row = await ctx.db.one<any>(
              `update public.import_watch_folders set path=$1, enabled=$2, method_id=$3,
               column_id=$4, batch_id=$5, file_pattern=$6 where id=$7 returning *`,
              [parsed.path, parsed.enabled, parsed.methodId ?? null, parsed.columnId ?? null,
               parsed.batchId ?? null, parsed.filePattern, parsed.id],
            );
            return Response.json(mapImportWatchFolder(row));
          }
          const row = await ctx.db.one<any>(
            `insert into public.import_watch_folders (path, enabled, method_id, column_id, batch_id, file_pattern, created_by)
             values ($1,$2,$3,$4,$5,$6,$7) returning *`,
            [parsed.path, parsed.enabled, parsed.methodId ?? null, parsed.columnId ?? null,
             parsed.batchId ?? null, parsed.filePattern, ctx.userId],
          );
          return Response.json(mapImportWatchFolder(row));
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Failed to save watch folder" }, { status: 500 });
        }
      },
    },
  },
});
