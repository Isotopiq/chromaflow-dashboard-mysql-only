// Pure anomaly-detection functions for batches, samples, compounds, and QC runs.
// No server-only imports — safe to use from both client and server.
import type { Peak, Run, Batch, ColumnInjection, AnomalyCheck } from "./lab-types";

// ---------- Stats helpers ----------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function rsdPct(values: number[]): number {
  const m = mean(values);
  if (m === 0) return 0;
  return (stdev(values) / Math.abs(m)) * 100;
}

function pctDeviation(value: number, reference: number): number {
  if (reference === 0) return 0;
  return ((value - reference) / reference) * 100;
}

// ---------- Types ----------

type RunWithPeaks = {
  id: string;
  name: string;
  batchId?: string | null;
  columnId?: string | null;
  acquiredAt: string;
  peaks: Peak[];
};

type QcSampleLike = {
  id: string;
  expectedConc: number;
  measuredConc: number | null;
  accuracyPct: number | null;
  passed: boolean | null;
};

type AnomalyInput = {
  scope: "batch" | "sample" | "compound" | "qc";
  batchId?: string | null;
  columnId?: string | null;
  runs?: RunWithPeaks[];
  injections?: ColumnInjection[];
  qcSamples?: QcSampleLike[];
  batch?: Batch | null;
  // Thresholds (with defaults)
  rtDriftPct?: number;
  areaRsdMax?: number;
  fwhmIncreasePct?: number;
  signalDropPct?: number;
  qcAcceptancePct?: number;
  pressureSpikePct?: number;
};

type NewCheck = Omit<AnomalyCheck, "id" | "resolved" | "resolvedBy" | "resolvedAt" | "createdBy" | "createdAt">;

// ---------- Individual checks ----------

/**
 * Flags analytes whose RT deviates more than threshold% from the median RT
 * across all runs in the batch.
 */
export function checkRtDrift(
  runs: RunWithPeaks[],
  thresholdPct = 5,
  batchId?: string | null,
): NewCheck[] {
  const checks: NewCheck[] = [];
  // Group peaks by analyteId across runs
  const byAnalyte = new Map<string, Array<{ runId: string; runName: string; rt: number }>>();
  for (const run of runs) {
    for (const peak of run.peaks) {
      if (!peak.analyteId) continue;
      const arr = byAnalyte.get(peak.analyteId) ?? [];
      arr.push({ runId: run.id, runName: run.name, rt: peak.rt });
      byAnalyte.set(peak.analyteId, arr);
    }
  }
  for (const [analyteId, entries] of byAnalyte) {
    if (entries.length < 2) continue;
    const rts = entries.map((e) => e.rt);
    const med = median(rts);
    for (const entry of entries) {
      const dev = pctDeviation(entry.rt, med);
      if (Math.abs(dev) > thresholdPct) {
        const name = entries[0].runName;
        checks.push({
          scope: "compound",
          scopeId: analyteId,
          batchId: batchId ?? null,
          columnId: null,
          checkType: "rt_drift",
          severity: Math.abs(dev) > thresholdPct * 2 ? "critical" : "warning",
          message: `RT drift ${dev.toFixed(1)}% from median (${med.toFixed(2)} min) for analyte in run "${entry.runName}"`,
          metricsJson: { rt: entry.rt, medianRt: med, deviationPct: dev, runId: entry.runId },
        });
      }
    }
  }
  return checks;
}

/**
 * Flags analytes whose area RSD% exceeds the threshold across replicate
 * injections.
 */
export function checkAreaRsd(
  runs: RunWithPeaks[],
  maxRsd = 20,
  batchId?: string | null,
): NewCheck[] {
  const checks: NewCheck[] = [];
  const byAnalyte = new Map<string, number[]>();
  for (const run of runs) {
    for (const peak of run.peaks) {
      if (!peak.analyteId) continue;
      const arr = byAnalyte.get(peak.analyteId) ?? [];
      arr.push(peak.area);
      byAnalyte.set(peak.analyteId, arr);
    }
  }
  for (const [analyteId, areas] of byAnalyte) {
    if (areas.length < 3) continue;
    const r = rsdPct(areas);
    if (r > maxRsd) {
      checks.push({
        scope: "compound",
        scopeId: analyteId,
        batchId: batchId ?? null,
        columnId: null,
        checkType: "area_rsd",
        severity: r > maxRsd * 2 ? "critical" : "warning",
        message: `Area RSD ${r.toFixed(1)}% exceeds threshold ${maxRsd}% across ${areas.length} replicate injections`,
        metricsJson: { rsdPct: r, replicateCount: areas.length, meanArea: mean(areas) },
      });
    }
  }
  return checks;
}

/**
 * Flags analytes whose FWHM increases more than threshold% relative to the
 * first QC run (indicating peak-shape degradation).
 */
export function checkPeakShapeDegradation(
  runs: RunWithPeaks[],
  maxFwhmIncrease = 50,
  batchId?: string | null,
): NewCheck[] {
  const checks: NewCheck[] = [];
  const byAnalyte = new Map<string, Array<{ runId: string; runName: string; fwhm: number; acquiredAt: string }>>();
  for (const run of runs) {
    for (const peak of run.peaks) {
      if (!peak.analyteId || peak.fwhm <= 0) continue;
      const arr = byAnalyte.get(peak.analyteId) ?? [];
      arr.push({ runId: run.id, runName: run.name, fwhm: peak.fwhm, acquiredAt: run.acquiredAt });
      byAnalyte.set(peak.analyteId, arr);
    }
  }
  for (const [analyteId, entries] of byAnalyte) {
    if (entries.length < 2) continue;
    // Sort by acquisition time to find the first run
    const sorted = [...entries].sort((a, b) => a.acquiredAt.localeCompare(b.acquiredAt));
    const baseline = sorted[0].fwhm;
    if (baseline <= 0) continue;
    for (const entry of sorted.slice(1)) {
      const increase = pctDeviation(entry.fwhm, baseline);
      if (increase > maxFwhmIncrease) {
        checks.push({
          scope: "compound",
          scopeId: analyteId,
          batchId: batchId ?? null,
          columnId: null,
          checkType: "peak_shape_degradation",
          severity: increase > maxFwhmIncrease * 2 ? "critical" : "warning",
          message: `FWHM increased ${increase.toFixed(0)}% from baseline (${baseline.toFixed(3)} → ${entry.fwhm.toFixed(3)} min) in run "${entry.runName}"`,
          metricsJson: { baselineFwhm: baseline, currentFwhm: entry.fwhm, increasePct: increase, runId: entry.runId },
        });
      }
    }
  }
  return checks;
}

/**
 * Flags analytes whose area drops more than threshold% from the median area.
 */
export function checkSignalDropoff(
  runs: RunWithPeaks[],
  maxDropPct = 50,
  batchId?: string | null,
): NewCheck[] {
  const checks: NewCheck[] = [];
  const byAnalyte = new Map<string, Array<{ runId: string; runName: string; area: number }>>();
  for (const run of runs) {
    for (const peak of run.peaks) {
      if (!peak.analyteId) continue;
      const arr = byAnalyte.get(peak.analyteId) ?? [];
      arr.push({ runId: run.id, runName: run.name, area: peak.area });
      byAnalyte.set(peak.analyteId, arr);
    }
  }
  for (const [analyteId, entries] of byAnalyte) {
    if (entries.length < 2) continue;
    const areas = entries.map((e) => e.area);
    const med = median(areas);
    for (const entry of entries) {
      const drop = -pctDeviation(entry.area, med); // positive = drop
      if (drop > maxDropPct) {
        checks.push({
          scope: "compound",
          scopeId: analyteId,
          batchId: batchId ?? null,
          columnId: null,
          checkType: "signal_dropoff",
          severity: drop > maxDropPct * 1.5 ? "critical" : "warning",
          message: `Signal dropped ${drop.toFixed(0)}% from median area (${med.toFixed(0)}) in run "${entry.runName}"`,
          metricsJson: { area: entry.area, medianArea: med, dropPct: drop, runId: entry.runId },
        });
      }
    }
  }
  return checks;
}

/**
 * Flags QC samples with accuracy outside ±acceptance%.
 */
export function checkQcAccuracy(
  qcSamples: QcSampleLike[],
  acceptancePct = 15,
  batchId?: string | null,
): NewCheck[] {
  const checks: NewCheck[] = [];
  for (const qc of qcSamples) {
    if (qc.accuracyPct == null) continue;
    if (Math.abs(qc.accuracyPct) > acceptancePct) {
      checks.push({
        scope: "qc",
        scopeId: qc.id,
        batchId: batchId ?? null,
        columnId: null,
        checkType: "qc_accuracy",
        severity: Math.abs(qc.accuracyPct) > acceptancePct * 2 ? "critical" : "warning",
        message: `QC accuracy ${qc.accuracyPct.toFixed(1)}% exceeds ±${acceptancePct}% acceptance (expected ${qc.expectedConc}, measured ${qc.measuredConc ?? "—"})`,
        metricsJson: { accuracyPct: qc.accuracyPct, expectedConc: qc.expectedConc, measuredConc: qc.measuredConc ?? 0 },
      });
    }
  }
  return checks;
}

/**
 * Flags pressure spikes in the column injection log.
 */
export function checkColumnPressureTrend(
  injections: ColumnInjection[],
  maxSpikePct = 30,
  columnId?: string | null,
): NewCheck[] {
  const checks: NewCheck[] = [];
  const withPressure = injections
    .filter((i) => i.startingPressure != null)
    .sort((a, b) => a.injectionNum - b.injectionNum);
  if (withPressure.length < 2) return checks;
  for (let i = 1; i < withPressure.length; i++) {
    const prev = withPressure[i - 1].startingPressure!;
    const curr = withPressure[i].startingPressure!;
    if (prev === 0) continue;
    const spike = Math.abs(pctDeviation(curr, prev));
    if (spike > maxSpikePct) {
      checks.push({
        scope: "sample",
        scopeId: withPressure[i].id,
        batchId: null,
        columnId: columnId ?? null,
        checkType: "pressure_spike",
        severity: spike > maxSpikePct * 2 ? "critical" : "warning",
        message: `Pressure ${spike > 0 ? "spike" : "drop"} of ${spike.toFixed(0)}% between injection #${withPressure[i - 1].injectionNum} (${prev} bar) and #${withPressure[i].injectionNum} (${curr} bar)`,
        metricsJson: { prevPressure: prev, currPressure: curr, spikePct: spike, injectionNum: withPressure[i].injectionNum },
      });
    }
  }
  return checks;
}

/**
 * Flags batches with no runs or very few runs relative to expected sample count.
 */
export function checkBatchCompleteness(
  batch: Batch,
  runs: RunWithPeaks[],
): NewCheck[] {
  const checks: NewCheck[] = [];
  const batchRuns = runs.filter((r) => r.batchId === batch.id);
  if (batchRuns.length === 0) {
    checks.push({
      scope: "batch",
      scopeId: batch.id,
      batchId: batch.id,
      columnId: null,
      checkType: "empty_batch",
      severity: "warning",
      message: `Batch "${batch.name}" has no runs uploaded`,
      metricsJson: { runCount: 0 },
    });
  }
  return checks;
}

// ---------- Aggregate runner ----------

export function runAllAnomalyChecks(input: AnomalyInput): NewCheck[] {
  const all: NewCheck[] = [];
  const runs = input.runs ?? [];
  const injections = input.injections ?? [];
  const qcSamples = input.qcSamples ?? [];

  if (runs.length > 0) {
    all.push(...checkRtDrift(runs, input.rtDriftPct ?? 5, input.batchId));
    all.push(...checkAreaRsd(runs, input.areaRsdMax ?? 20, input.batchId));
    all.push(...checkPeakShapeDegradation(runs, input.fwhmIncreasePct ?? 50, input.batchId));
    all.push(...checkSignalDropoff(runs, input.signalDropPct ?? 50, input.batchId));
  }

  if (qcSamples.length > 0) {
    all.push(...checkQcAccuracy(qcSamples, input.qcAcceptancePct ?? 15, input.batchId));
  }

  if (injections.length > 1) {
    all.push(...checkColumnPressureTrend(injections, input.pressureSpikePct ?? 30, input.columnId));
  }

  if (input.batch) {
    all.push(...checkBatchCompleteness(input.batch, runs));
  }

  return all;
}

export { median, mean, stdev, rsdPct, pctDeviation };
