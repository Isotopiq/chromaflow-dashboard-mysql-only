import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import { deconvolvePeak } from "@/lib/deconvolution-math";
import { downloadObject } from "@/lib/storage.server";
import { unpackScans } from "@/lib/eic";

const DeconvolveInput = z.object({ peakId: z.string().uuid() });

export const deconvolvePeakServer = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeconvolveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    const peak = await db.one<any>(
      "select * from public.peaks where id=$1", [data.peakId],
    );
    const run = await db.one<any>(
      "select * from public.runs where id=$1", [peak.run_id],
    );

    // Download scans
    let scansBlob: Uint8Array | null = null;
    try {
      scansBlob = await downloadObject("raw-runs", run.scans_blob_path);
    } catch {
      throw new Error("Scan data not available for this run.");
    }

    if (!scansBlob) throw new Error("Scan data not available.");

    const scans = unpackScans(scansBlob);
    // Build EIC around the peak
    const rtStart = Math.max(0, Number(peak.rt) - 1);
    const rtEnd = Number(peak.rt) + 1;
    const mzLow = peak.mz_low ? Number(peak.mz_low) : (peak.mz ? Number(peak.mz) - 0.01 : null);
    const mzHigh = peak.mz_high ? Number(peak.mz_high) : (peak.mz ? Number(peak.mz) + 0.01 : null);

    if (mzLow == null || mzHigh == null) throw new Error("Peak has no m/z range.");

    const x: number[] = [];
    const y: number[] = [];
    for (const scan of scans) {
      if (scan.rt < rtStart || scan.rt > rtEnd) continue;
      let intensity = 0;
      for (let i = 0; i < scan.mz.length; i++) {
        if (scan.mz[i] >= mzLow && scan.mz[i] <= mzHigh) {
          intensity += scan.intens[i];
        }
      }
      x.push(scan.rt);
      y.push(intensity);
    }

    if (x.length < 5) throw new Error("Not enough data points for deconvolution.");

    const result = deconvolvePeak(x, y, rtStart, rtEnd);

    // Store result
    await db.one<any>(
      `insert into public.peak_deconvolution (peak_id, component_count, components_json)
       values ($1, $2, $3) returning *`,
      [data.peakId, result.componentCount, JSON.stringify(result.components)],
    );

    // Mark peak as deconvolved
    await db.query(
      "update public.peaks set deconvolved=true where id=$1", [data.peakId],
    );

    return result;
  });
