// Desktop companion lab-data endpoint.
// Returns methods, columns, batches, and compound lists so the desktop app
// can populate dropdowns in Settings / Watch Directories.
import { createFileRoute } from "@tanstack/react-router";
import { requireBearerAuth } from "@/lib/desktop-auth";
import {
  mapMethod,
  mapColumn,
  mapBatch,
  mapCompoundList,
} from "@/lib/lab-data.server";

export const Route = createFileRoute("/api/desktop/lab-data")({
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
          const columns = await ctx.db.many<any>(
            "select * from public.columns order by created_at desc",
          );
          const methods = await ctx.db.many<any>(
            "select * from public.methods order by updated_at desc",
          );
          const batches = await ctx.db.many<any>(
            "select * from public.batches order by started_at desc",
          );
          const compoundListsRaw = await ctx.db.many<any>(
            "select * from public.compound_lists order by name",
          );
          const listEntries = await ctx.db.many<any>(
            "select * from public.compound_list_entries",
          );

          // Group compound list entries by list_id
          const entriesByList = new Map<string, string[]>();
          for (const e of listEntries) {
            const arr = entriesByList.get(e.list_id) ?? [];
            arr.push(e.analyte_id);
            entriesByList.set(e.list_id, arr);
          }

          // Group run IDs by batch
          const runsByBatch = new Map<string, string[]>();
          try {
            const runs = await ctx.db.many<any>(
              "select id, batch_id from public.runs where batch_id is not null",
            );
            for (const r of runs) {
              const arr = runsByBatch.get(r.batch_id) ?? [];
              arr.push(r.id);
              runsByBatch.set(r.batch_id, arr);
            }
          } catch {}

          return Response.json({
            methods: methods.map(mapMethod),
            columns: columns.map(mapColumn),
            batches: batches.map((b: any) => mapBatch(b, runsByBatch.get(b.id) ?? [])),
            compoundLists: compoundListsRaw.map((cl: any) =>
              mapCompoundList(cl, entriesByList.get(cl.id) ?? []),
            ),
          });
        } catch (e: any) {
          return Response.json({ error: e?.message ?? "Failed to load lab data" }, { status: 500 });
        }
      },
    },
  },
});
