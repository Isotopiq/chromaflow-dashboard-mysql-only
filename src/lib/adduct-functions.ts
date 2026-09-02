import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import { detectAdducts, findAdductPeaks } from "@/lib/adduct-detection";
import { monoisotopicMass } from "@/lib/chem";

const DetectAdductsInput = z.object({
  runId: z.string().uuid(),
  ppmTol: z.number().default(10),
});

export const detectAdductsServer = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DetectAdductsInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };

    // Get all annotated peaks in the run with their analyte info
    const peaks = await db.many<any>(
      `select p.id, p.rt, p.area, p.mz, p.analyte_id, a.name as analyte_name,
              a.formula, a.mz as analyte_mz
       from public.peaks p
       left join public.analytes a on p.analyte_id = a.id
       where p.run_id = $1 and p.mz is not null
       order by p.area desc`,
      [data.runId],
    );

    // Get the method to determine ionization mode
    const run = await db.one<any>(
      "select method_id from public.runs where id=$1", [data.runId],
    );
    const method = run.method_id
      ? await db.maybe<any>("select ionization from public.methods where id=$1", [run.method_id])
      : null;

    const ionMode = method?.ionization?.includes("neg") ? "negative" : "positive";

    let count = 0;
    for (const peak of peaks) {
      if (!peak.analyte_id || !peak.formula) continue;

      const neutralMass = monoisotopicMass(peak.formula);
      if (!neutralMass) continue;

      const observedMz = Number(peak.mz);
      const matches = detectAdducts(neutralMass, observedMz, ionMode as "positive" | "negative", data.ppmTol);

      if (matches.length > 0) {
        const best = matches[0];
        // Store the detection
        await db.query(
          `insert into public.adduct_detections (peak_id, analyte_id, adduct_type, mz_observed, mz_theoretical, ppm_error, is_in_source_fragment)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [peak.id, peak.analyte_id, best.adductType, observedMz, best.mzTheoretical, best.ppmError, best.isInSourceFragment],
        );
        // Update peak adduct_type
        await db.query(
          "update public.peaks set adduct_type=$1 where id=$2",
          [best.adductType, peak.id],
        );
        count++;
      }
    }

    return { count };
  });
