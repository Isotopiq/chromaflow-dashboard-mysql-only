import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import { notify } from "@/lib/notifications.functions";
import {
  fitLinearCurve,
  calcConcentration,
  calcAccuracy,
  qcPassed,
  type Weighting,
} from "@/lib/calibration-math";

// ---- Types ----
export type CalibrationStandard = {
  id: string;
  analyteId: string;
  runId: string;
  peakId: string | null;
  concentration: number;
  concentrationUnit: string;
  response: number | null;
  responseType: string;
  level: number | null;
  excluded: boolean;
  createdAt: string;
};

export type CalibrationCurve = {
  id: string;
  analyteId: string;
  batchId: string | null;
  methodId: string | null;
  name: string;
  modelType: string;
  weighting: string;
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
  lod: number | null;
  loq: number | null;
  rangeLow: number | null;
  rangeHigh: number | null;
  createdAt: string;
};

export type QCSample = {
  id: string;
  curveId: string;
  runId: string;
  peakId: string | null;
  expectedConc: number;
  measuredConc: number | null;
  accuracyPct: number | null;
  passed: boolean | null;
  acceptancePct: number;
  createdAt: string;
};

function mapStandard(r: any): CalibrationStandard {
  return {
    id: r.id,
    analyteId: r.analyte_id,
    runId: r.run_id,
    peakId: r.peak_id ?? null,
    concentration: Number(r.concentration),
    concentrationUnit: r.concentration_unit ?? "ng/mL",
    response: r.response != null ? Number(r.response) : null,
    responseType: r.response_type ?? "area",
    level: r.level ?? null,
    excluded: r.excluded === true,
    createdAt: String(r.created_at),
  };
}

function mapCurve(r: any): CalibrationCurve {
  return {
    id: r.id,
    analyteId: r.analyte_id,
    batchId: r.batch_id ?? null,
    methodId: r.method_id ?? null,
    name: r.name ?? "",
    modelType: r.model_type ?? "linear",
    weighting: r.weighting ?? "none",
    slope: r.slope != null ? Number(r.slope) : null,
    intercept: r.intercept != null ? Number(r.intercept) : null,
    rSquared: r.r_squared != null ? Number(r.r_squared) : null,
    lod: r.lod != null ? Number(r.lod) : null,
    loq: r.loq != null ? Number(r.loq) : null,
    rangeLow: r.range_low != null ? Number(r.range_low) : null,
    rangeHigh: r.range_high != null ? Number(r.range_high) : null,
    createdAt: String(r.created_at),
  };
}

function mapQc(r: any): QCSample {
  return {
    id: r.id,
    curveId: r.curve_id,
    runId: r.run_id,
    peakId: r.peak_id ?? null,
    expectedConc: Number(r.expected_conc),
    measuredConc: r.measured_conc != null ? Number(r.measured_conc) : null,
    accuracyPct: r.accuracy_pct != null ? Number(r.accuracy_pct) : null,
    passed: r.passed,
    acceptancePct: Number(r.acceptance_pct ?? 15),
    createdAt: String(r.created_at),
  };
}

// ---- List calibration curves ----
export const listCalibrationCurves = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const rows = await db.many<any>(
      `select c.*, a.name as analyte_name
         from public.calibration_curves c
         join public.analytes a on a.id = c.analyte_id
        order by c.created_at desc`,
    );
    return rows.map((r) => ({ ...mapCurve(r), analyteName: r.analyte_name }));
  });

// ---- Get a single curve with its standards ----
export const getCalibrationCurve = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const curve = await db.maybe<any>(
      `select c.*, a.name as analyte_name
         from public.calibration_curves c
         join public.analytes a on a.id = c.analyte_id
        where c.id = $1`,
      [data.id],
    );
    if (!curve) return { curve: null, standards: [], qcSamples: [] };
    const standards = await db.many<any>(
      `select s.*, r.file_path, p.rt, p.area, p.height
         from public.calibration_standards s
         left join public.runs r on r.id = s.run_id
         left join public.peaks p on p.id = s.peak_id
        where s.analyte_id = $1
        order by s.concentration asc`,
      [curve.analyte_id],
    );
    const qcSamples = await db.many<any>(
      `select q.*, r.file_path
         from public.qc_samples q
         left join public.runs r on r.id = q.run_id
        where q.curve_id = $1
        order by q.created_at desc`,
      [data.id],
    );
    return {
      curve: { ...mapCurve(curve), analyteName: curve.analyte_name },
      standards: standards.map(mapStandard),
      qcSamples: qcSamples.map(mapQc),
    };
  });

// ---- Link a calibration standard ----
const StandardInput = z.object({
  analyteId: z.string().uuid(),
  runId: z.string().uuid(),
  peakId: z.string().uuid().nullable().optional(),
  concentration: z.number().min(0),
  concentrationUnit: z.string().max(20).default("ng/mL"),
  responseType: z.enum(["area", "height"]).default("area"),
  level: z.number().int().min(1).max(100).optional(),
});

export const linkCalibrationStandard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => StandardInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    // Auto-fill response from peak if available
    let response: number | null = null;
    if (data.peakId) {
      const peak = await db.maybe<any>(
        `select area, height from public.peaks where id = $1`,
        [data.peakId],
      );
      if (peak) {
        response = data.responseType === "height" ? Number(peak.height) : Number(peak.area);
      }
    }
    const row = await db.one<any>(
      `insert into public.calibration_standards
         (analyte_id, run_id, peak_id, concentration, concentration_unit, response, response_type, level, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [data.analyteId, data.runId, data.peakId ?? null, data.concentration,
       data.concentrationUnit, response, data.responseType, data.level ?? null, userId],
    );
    return mapStandard(row);
  });

// ---- Toggle standard exclusion ----
export const toggleStandardExcluded = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid(), excluded: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query(
      "update public.calibration_standards set excluded = $1 where id = $2",
      [data.excluded, data.id],
    );
    return { ok: true };
  });

// ---- Delete a standard ----
export const deleteCalibrationStandard = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.calibration_standards where id = $1", [data.id]);
    return { ok: true };
  });

// ---- Fit a calibration curve ----
const FitInput = z.object({
  analyteId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  methodId: z.string().uuid().nullable().optional(),
  name: z.string().max(200).default(""),
  weighting: z.enum(["none", "1/x", "1/x2"]).default("none"),
  lodN: z.number().int().min(1).max(20).default(3),
  loqN: z.number().int().min(1).max(50).default(10),
});

export const fitCalibrationCurve = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => FitInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    // Fetch all non-excluded standards for this analyte
    const rows = await db.many<any>(
      `select * from public.calibration_standards
        where analyte_id = $1 and excluded = false and response is not null
        order by concentration asc`,
      [data.analyteId],
    );
    if (rows.length < 2) {
      throw new Error("Need at least 2 non-excluded standards with response values to fit a curve.");
    }
    const points = rows.map((r) => ({
      concentration: Number(r.concentration),
      response: Number(r.response),
    }));
    const fit = fitLinearCurve(points, data.weighting as Weighting, data.lodN, data.loqN);
    if (!fit) throw new Error("Curve fitting failed — check that concentrations and responses are valid.");

    const curve = await db.one<any>(
      `insert into public.calibration_curves
         (analyte_id, batch_id, method_id, name, model_type, weighting,
          slope, intercept, r_squared, lod, loq, range_low, range_high, created_by)
       values ($1,$2,$3,$4,'linear',$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning *`,
      [data.analyteId, data.batchId ?? null, data.methodId ?? null, data.name,
       data.weighting, fit.slope, fit.intercept, fit.rSquared,
       fit.lod, fit.loq, fit.rangeLow, fit.rangeHigh, userId],
    );

    // Notification for poor curve fit
    if (fit.rSquared < 0.99) {
      await notify(
        db, userId, "calibration_drift",
        `Calibration curve R² = ${fit.rSquared.toFixed(4)} — below 0.99`,
        `Analyte: ${data.analyteId}. Consider reviewing calibration standards.`,
        `/quant`,
      );
    }

    return mapCurve(curve);
  });

// ---- Delete a calibration curve ----
export const deleteCalibrationCurve = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.calibration_curves where id = $1", [data.id]);
    return { ok: true };
  });

// ---- Calculate concentration for unknown peaks ----
const CalcInput = z.object({
  curveId: z.string().uuid(),
  peakIds: z.array(z.string().uuid()).min(1).max(500),
});

export const calculateConcentrations = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => CalcInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const curve = await db.maybe<any>(
      "select * from public.calibration_curves where id = $1",
      [data.curveId],
    );
    if (!curve || curve.slope == null) throw new Error("Curve not found or not fitted.");
    const peaks = await db.many<any>(
      "select id, area, height from public.peaks where id = any($1::uuid[])",
      [data.peakIds],
    );
    const results = peaks.map((p) => {
      const response = curve.weighting === "height" ? Number(p.height) : Number(p.area);
      const conc = calcConcentration(response, Number(curve.slope), Number(curve.intercept));
      return { peakId: p.id, response, concentration: conc };
    });
    return { results };
  });

// ---- Add a QC sample ----
const QCInput = z.object({
  curveId: z.string().uuid(),
  runId: z.string().uuid(),
  peakId: z.string().uuid().nullable().optional(),
  expectedConc: z.number().min(0),
  acceptancePct: z.number().min(1).max(100).default(15),
});

export const addQCSample = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => QCInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const curve = await db.maybe<any>(
      "select * from public.calibration_curves where id = $1",
      [data.curveId],
    );
    if (!curve || curve.slope == null) throw new Error("Curve not found or not fitted.");

    // Get peak response
    let response: number | null = null;
    if (data.peakId) {
      const peak = await db.maybe<any>(
        "select area, height from public.peaks where id = $1",
        [data.peakId],
      );
      if (peak) {
        response = Number(peak.area);
      }
    }
    const measured = response != null
      ? calcConcentration(response, Number(curve.slope), Number(curve.intercept))
      : null;
    const accuracy = measured != null ? calcAccuracy(measured, data.expectedConc) : null;
    const passed = accuracy != null ? qcPassed(accuracy, data.acceptancePct) : null;

    const row = await db.one<any>(
      `insert into public.qc_samples
         (curve_id, run_id, peak_id, expected_conc, measured_conc, accuracy_pct, passed, acceptance_pct)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [data.curveId, data.runId, data.peakId ?? null, data.expectedConc,
       measured, accuracy, passed, data.acceptancePct],
    );

    // Notification for QC failure
    if (passed === false) {
      await notify(
        db, userId, "qc_fail",
        `QC sample failed accuracy check`,
        `Expected: ${data.expectedConc}, Measured: ${measured?.toFixed(2) ?? "N/A"}, Accuracy: ${accuracy?.toFixed(1)}% (acceptance: ±${data.acceptancePct}%)`,
        `/quant`,
      );
    }

    return mapQc(row);
  });

// ---- Delete QC sample ----
export const deleteQCSample = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.qc_samples where id = $1", [data.id]);
    return { ok: true };
  });

// ---- List standards for an analyte ----
export const listStandardsForAnalyte = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ analyteId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const rows = await db.many<any>(
      `select s.*, r.file_path, p.rt, p.area, p.height
         from public.calibration_standards s
         left join public.runs r on r.id = s.run_id
         left join public.peaks p on p.id = s.peak_id
        where s.analyte_id = $1
        order by s.concentration asc`,
      [data.analyteId],
    );
    return rows.map(mapStandard);
  });
