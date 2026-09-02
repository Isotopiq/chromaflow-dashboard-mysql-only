import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import { buildLandmarks, landmarkAlignment, linearAlignment } from "./alignment-math";

// ---- Run RT alignment for a batch ----
const AlignInput = z.object({
  batchId: z.string().uuid(),
  referenceRunId: z.string().uuid(),
  method: z.enum(["landmark", "linear"]).default("landmark"),
});

export const runRtAlignment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => AlignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    // Fetch all runs in the batch
    const runs = await db.many<any>(
      "select id from public.runs where batch_id = $1", [data.batchId]);
    if (runs.length === 0) throw new Error("No runs in batch.");

    // Fetch reference peaks (annotated ones)
    const refPeaks = await db.many<any>(
      "select analyte_id, rt from public.peaks where run_id = $1 and analyte_id is not null",
      [data.referenceRunId]);

    if (refPeaks.length < 2) {
      throw new Error("Reference run needs at least 2 annotated peaks for alignment.");
    }

    const allShifts: Record<string, number[]> = {};
    let totalAligned = 0;

    for (const run of runs) {
      if (run.id === data.referenceRunId) continue;

      const obsPeaks = await db.many<any>(
        "select analyte_id, rt from public.peaks where run_id = $1 and analyte_id is not null",
        [run.id]);

      const landmarks = buildLandmarks(
        refPeaks.map((p: any) => ({ analyteId: p.analyte_id, rt: Number(p.rt) })),
        obsPeaks.map((p: any) => ({ analyteId: p.analyte_id, rt: Number(p.rt) })),
      );

      if (landmarks.length === 0) continue;

      const result = data.method === "linear"
        ? linearAlignment(landmarks)
        : landmarkAlignment(landmarks);

      // Apply the shift to ALL peaks in this run (not just annotated ones)
      const allRunPeaks = await db.many<any>(
        "select id, rt from public.peaks where run_id = $1", [run.id]);

      for (const p of allRunPeaks) {
        const alignedRt = result.shiftFunction(Number(p.rt));
        await db.query(
          "update public.peaks set aligned_rt = $1 where id = $2",
          [alignedRt, p.id],
        );
        totalAligned++;
      }

      allShifts[run.id] = landmarks.map((lm) => lm.shift);
    }

    // Store the alignment record
    await db.one<any>(
      `insert into public.rt_alignment_runs
         (batch_id, reference_run_id, alignment_method, shift_json, created_by)
       values ($1, $2, $3, $4, $5) returning *`,
      [data.batchId, data.referenceRunId, data.method,
       JSON.stringify(allShifts), userId],
    );

    return { aligned: totalAligned, runs: runs.length - 1, shifts: allShifts };
  });

// ---- Clear alignment for a batch ----
const ClearAlignInput = z.object({ batchId: z.string().uuid() });

export const clearRtAlignment = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ClearAlignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const runs = await db.many<any>(
      "select id from public.runs where batch_id = $1", [data.batchId]);
    for (const r of runs) {
      await db.query(
        "update public.peaks set aligned_rt = null where run_id = $1", [r.id]);
    }
    await db.query("delete from public.rt_alignment_runs where batch_id = $1", [data.batchId]);
    return { ok: true };
  });
