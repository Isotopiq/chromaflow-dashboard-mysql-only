// Desktop companion create-run endpoint.
// Creates a run + peaks + auto-annotates against the analyte library.
// Mirrors the createRun server fn using the shared createRunInDb helper.
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireBearerAuth } from "@/lib/desktop-auth";
import { createRunInDb } from "@/lib/lab-data.server";
import { notify } from "@/lib/notifications.functions";
import { withUser } from "@/db/index.server";

const RunInput = z.object({
  name: z.string().min(1).max(300),
  methodId: z.string().optional().nullable(),
  columnId: z.string().optional().nullable(),
  batchId: z.string().optional().nullable(),
  filePath: z.string().max(500),
  scansBlobPath: z.string().max(500).optional().nullable(),
  fileFormat: z.enum(["mzML", "mzXML", "raw"]).default("mzML"),
  fileSize: z.string().max(40),
  ionMode: z.enum(["positive", "negative"]).default("positive"),
  msLevel: z.number().int().min(1).max(3).default(1),
  trace: z.object({
    x: z.array(z.number()).max(8000),
    tic: z.array(z.number()).max(8000),
    bpc: z.array(z.number()).max(8000),
  }),
  peaks: z.array(z.object({
    rt: z.number(),
    area: z.number(),
    height: z.number(),
    fwhm: z.number(),
    sn: z.number(),
    mz: z.number().nullable().optional(),
    mzLow: z.number().nullable().optional(),
    mzHigh: z.number().nullable().optional(),
    r2: z.number().nullable().optional(),
    asymmetry: z.number().nullable().optional(),
  })).max(1000),
  compoundListId: z.string().uuid().nullable().optional(),
});

export const Route = createFileRoute("/api/desktop/create-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let ctx;
        try {
          ctx = await requireBearerAuth(request);
        } catch (e: any) {
          return e instanceof Response ? e : Response.json({ error: "Unauthorized" }, { status: 401 });
        }
        let parsed;
        try {
          parsed = RunInput.parse(await request.json());
        } catch (e: any) {
          return Response.json({ error: "Invalid request body", details: e?.errors ?? e?.message }, { status: 400 });
        }
        try {
          const run = await createRunInDb(ctx.db, ctx.userId, parsed);

          // Notifications in a separate transaction — never block or rollback
          // the actual run insert.
          try {
            await withUser(ctx.userId, async (notifyDb) => {
              await notify(
                notifyDb,
                ctx.userId,
                "run_parsed",
                `Run "${parsed.name}" uploaded`,
                `${run.peaks.length} peaks detected${run.peaks.length > 0 ? " and auto-annotated" : ""}.`,
                `/runs/${run.id}`,
              );
              if (parsed.columnId) {
                const col = await notifyDb.maybe<any>(
                  "select name, used_injections, rated_injections from public.columns where id = $1",
                  [parsed.columnId],
                );
                if (col && col.rated_injections > 0) {
                  const pct = (Number(col.used_injections) / Number(col.rated_injections)) * 100;
                  if (pct >= 90) {
                    await notify(
                      notifyDb,
                      ctx.userId,
                      "column_eol",
                      `Column "${col.name}" nearing end of life`,
                      `${col.used_injections}/${col.rated_injections} injections used (${pct.toFixed(0)}%). Consider replacing soon.`,
                      `/columns/${parsed.columnId}`,
                    );
                  }
                }
              }
            });
          } catch {
            // Notifications are best-effort.
          }

          return Response.json({ run });
        } catch (e: any) {
          console.error("[create-run] failed:", e);
          return Response.json({ error: e?.message ?? "Failed to create run" }, { status: 500 });
        }
      },
    },
  },
});
