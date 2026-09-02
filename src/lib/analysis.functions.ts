// Server functions for batch-level analysis: peak picking, heatmap matrix, PCA.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import { downloadObject } from "@/lib/storage.server";
import { unpackScans } from "@/lib/eic";
import { runPCA, type PCAResult } from "@/lib/pca-math";

// ---- Types ----

export type BatchHeatmap = {
  analytes: Array<{ id: string; name: string; mz: number }>;
  runs: Array<{ id: string; name: string }>;
  matrix: (number | null)[][];
};

// ---- batchPeakPick ----
// For each run in a batch, fetch the scans blob, unpack, compute the TIC,
// and detect peaks via a simple threshold + local-maxima algorithm. Detected
// peaks are stored in the public.peaks table.
const BatchPeakPickInput = z.object({
  batchId: z.string().uuid(),
  snThreshold: z.number().min(1).max(100).default(3),
  minHeight: z.number().min(0).default(1000),
  smoothWindow: z.number().min(1).max(50).default(5),
});

export const batchPeakPick = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => BatchPeakPickInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as {
      userId: string;
      email: string;
      isAdmin: boolean;
      db: Db;
    };

    // Fetch all runs in the batch that have scan data.
    const runs = await db.many<any>(
      `select id, name, scans_blob_path, summary_json
         from public.runs
        where batch_id = $1 and scans_blob_path is not null
        order by acquired_at asc`,
      [data.batchId],
    );

    if (runs.length === 0) {
      return { picked: 0, runs: 0 };
    }

    let totalPicked = 0;

    for (const run of runs) {
      try {
        const buf = await downloadObject("raw-runs", run.scans_blob_path);
        if (buf.byteLength === 0) continue;

        const scans = unpackScans(buf);
        if (scans.length === 0) continue;

        // Build TIC trace: sum of intensities per scan.
        const rt: number[] = [];
        const tic: number[] = [];
        for (const s of scans) {
          let sum = 0;
          for (let i = 0; i < s.intens.length; i++) sum += s.intens[i];
          rt.push(s.rt);
          tic.push(sum);
        }

        // Smooth the TIC with a moving average.
        const smoothed = smoothArray(tic, data.smoothWindow);

        // Estimate noise as the median absolute deviation of the baseline.
        const noise = estimateNoise(smoothed);
        const threshold = Math.max(data.minHeight, noise * data.snThreshold);

        // Detect local maxima above the threshold.
        const peaks = detectPeaks(rt, smoothed, threshold, noise);

        // Remove existing peaks for this run (from prior batch picks) before
        // inserting fresh ones. Only remove auto-detected peaks to preserve
        // manual annotations.
        await db.query(
          "delete from public.peaks where run_id = $1 and manual = false and annotation_source is null",
          [run.id],
        );

        for (const p of peaks) {
          await db.query(
            `insert into public.peaks
               (run_id, rt, area, height, fwhm, sn)
             values ($1, $2, $3, $4, $5, $6)`,
            [run.id, p.rt, p.area, p.height, p.fwhm, p.sn],
          );
          totalPicked++;
        }
      } catch {
        // Skip runs that fail to parse — don't abort the whole batch.
        continue;
      }
    }

    return { picked: totalPicked, runs: runs.length };
  });

// ---- getBatchHeatmap ----
// Queries peaks joined with analytes for all runs in a batch and returns a
// matrix where matrix[runIdx][analyteIdx] = peak area (or null).
const BatchHeatmapInput = z.object({
  batchId: z.string().uuid(),
});

export const getBatchHeatmap = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => BatchHeatmapInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as {
      userId: string;
      email: string;
      isAdmin: boolean;
      db: Db;
    };

    // Fetch all runs in the batch.
    const runs = await db.many<any>(
      `select id, summary_json
         from public.runs
        where batch_id = $1
        order by acquired_at asc`,
      [data.batchId],
    );

    const runIds = runs.map((r) => r.id);
    const runNames = runs.map((r) => {
      const s = r.summary_json ?? {};
      return s.name ?? r.id.slice(0, 8);
    });

    // Fetch all annotated peaks for these runs, joined with analytes.
    const peaks = await db.many<any>(
      `select p.run_id, p.area, p.analyte_id, a.name as analyte_name, a.mz
         from public.peaks p
         join public.analytes a on a.id = p.analyte_id
        where p.run_id = any($1::uuid[]) and p.analyte_id is not null
        order by a.name`,
      [runIds],
    );

    // Build the set of analytes present across the batch.
    const analyteMap = new Map<string, { id: string; name: string; mz: number }>();
    for (const p of peaks) {
      if (!analyteMap.has(p.analyte_id)) {
        analyteMap.set(p.analyte_id, {
          id: p.analyte_id,
          name: p.analyte_name ?? p.analyte_id,
          mz: Number(p.mz ?? 0),
        });
      }
    }
    const analytes = Array.from(analyteMap.values());

    // Build a lookup: (runId, analyteId) -> max area (in case of duplicates).
    const areaMap = new Map<string, number>();
    for (const p of peaks) {
      const key = `${p.run_id}|${p.analyte_id}`;
      const area = Number(p.area ?? 0);
      const existing = areaMap.get(key);
      if (existing === undefined || area > existing) {
        areaMap.set(key, area);
      }
    }

    // Build the matrix [runIdx][analyteIdx].
    const matrix: (number | null)[][] = [];
    for (let r = 0; r < runIds.length; r++) {
      const row: (number | null)[] = [];
      for (let a = 0; a < analytes.length; a++) {
        const key = `${runIds[r]}|${analytes[a].id}`;
        const area = areaMap.get(key);
        row.push(area !== undefined ? area : null);
      }
      matrix.push(row);
    }

    const result: BatchHeatmap = {
      analytes,
      runs: runIds.map((id, i) => ({ id, name: runNames[i] })),
      matrix,
    };
    return result;
  });

// ---- getBatchPCA ----
// Builds a data matrix from peaks (same as heatmap) and runs PCA.
const BatchPCAInput = z.object({
  batchId: z.string().uuid(),
});

export const getBatchPCA = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => BatchPCAInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as {
      userId: string;
      email: string;
      isAdmin: boolean;
      db: Db;
    };

    // Fetch all runs in the batch.
    const runs = await db.many<any>(
      `select id, summary_json
         from public.runs
        where batch_id = $1
        order by acquired_at asc`,
      [data.batchId],
    );

    const runIds = runs.map((r) => r.id);
    const runLabels = runs.map((r) => {
      const s = r.summary_json ?? {};
      return s.name ?? r.id.slice(0, 8);
    });

    if (runIds.length < 2) {
      return {
        scores: [],
        loadings: [],
        explainedVariance: [0, 0, 0],
      } as PCAResult;
    }

    // Fetch all annotated peaks for these runs, joined with analytes.
    const peaks = await db.many<any>(
      `select p.run_id, p.area, p.analyte_id, a.name as analyte_name
         from public.peaks p
         join public.analytes a on a.id = p.analyte_id
        where p.run_id = any($1::uuid[]) and p.analyte_id is not null`,
      [runIds],
    );

    // Build the set of analytes.
    const analyteIds: string[] = [];
    const analyteNames: string[] = [];
    const analyteSet = new Set<string>();
    for (const p of peaks) {
      if (!analyteSet.has(p.analyte_id)) {
        analyteSet.add(p.analyte_id);
        analyteIds.push(p.analyte_id);
        analyteNames.push(p.analyte_name ?? p.analyte_id);
      }
    }

    if (analyteIds.length === 0) {
      return {
        scores: runLabels.map((label) => ({ runId: label, pc1: 0, pc2: 0, pc3: 0, label })),
        loadings: [],
        explainedVariance: [0, 0, 0],
      } as PCAResult;
    }

    // Build area lookup: (runId, analyteId) -> max area.
    const areaMap = new Map<string, number>();
    for (const p of peaks) {
      const key = `${p.run_id}|${p.analyte_id}`;
      const area = Number(p.area ?? 0);
      const existing = areaMap.get(key);
      if (existing === undefined || area > existing) {
        areaMap.set(key, area);
      }
    }

    // Build the data matrix [nRuns][nAnalytes], filling missing with 0.
    const dataMatrix: number[][] = [];
    for (let r = 0; r < runIds.length; r++) {
      const row: number[] = [];
      for (let a = 0; a < analyteIds.length; a++) {
        const key = `${runIds[r]}|${analyteIds[a]}`;
        row.push(areaMap.get(key) ?? 0);
      }
      dataMatrix.push(row);
    }

    return runPCA(dataMatrix, runLabels, analyteNames);
  });

// ---- Helpers ----

/** Moving-average smoothing. */
function smoothArray(arr: number[], window: number): number[] {
  if (window <= 1) return [...arr];
  const half = Math.floor(window / 2);
  const out: number[] = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(arr.length - 1, i + half); j++) {
      sum += arr[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/** Estimate noise via median absolute deviation of the full signal. */
function estimateNoise(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = arr.map((v) => Math.abs(v - median));
  deviations.sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  // 1.4826 converts MAD to standard deviation for normal distributions.
  return mad * 1.4826 || 1;
}

type DetectedPeak = {
  rt: number;
  area: number;
  height: number;
  fwhm: number;
  sn: number;
};

/**
 * Simple peak detection: a peak is a local maximum above `threshold` where
 * both neighbors are lower. Area is estimated by trapezoidal integration
 * within the half-height boundaries. FWHM is approximated from the width
 * at half the peak height.
 */
function detectPeaks(
  rt: number[],
  tic: number[],
  threshold: number,
  noise: number,
): DetectedPeak[] {
  const peaks: DetectedPeak[] = [];
  if (tic.length < 3) return peaks;

  for (let i = 1; i < tic.length - 1; i++) {
    if (tic[i] <= threshold) continue;
    if (tic[i] <= tic[i - 1] || tic[i] <= tic[i + 1]) continue;

    const height = tic[i];
    const halfHeight = height / 2;

    // Walk left to find half-height crossing.
    let left = i;
    while (left > 0 && tic[left] > halfHeight) left--;
    // Walk right to find half-height crossing.
    let right = i;
    while (right < tic.length - 1 && tic[right] > halfHeight) right++;

    // FWHM in RT units.
    const fwhm = Math.max(0, rt[right] - rt[left]);

    // Area via trapezoidal integration between left and right boundaries.
    let area = 0;
    for (let j = left; j < right; j++) {
      const dx = (rt[j + 1] ?? rt[j]) - rt[j];
      if (dx <= 0) continue;
      area += 0.5 * (tic[j] + tic[j + 1]) * dx;
    }

    const sn = noise > 0 ? height / noise : 0;

    peaks.push({ rt: rt[i], area, height, fwhm, sn });
  }

  return peaks;
}
