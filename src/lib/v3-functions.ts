import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import {
  mapSampleQueue, mapSampleQueueEntry, mapMethodTemplate,
  mapReportJob, mapCustomColumn, mapImportWatchFolder,
  mapImportedFile, mapISAssignment,
  mapBufferExchangeEvent, mapQcRun, mapAnomalyCheck,
} from "@/lib/lab-data.server";
import { parseSldFileFromArrayBuffer } from "@/lib/sld-import";
import { runAllAnomalyChecks } from "@/lib/anomaly-checks";

// =====================================================================
// Sample Queue CRUD
// =====================================================================

const QueueInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  batchId: z.string().uuid().nullable().optional(),
  instrument: z.string().default(""),
});

export const upsertSampleQueue = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => QueueInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (data.id) {
      const row = await db.one<any>(
        `update public.sample_queues set name=$1, batch_id=$2, instrument=$3
         where id=$4 returning *`,
        [data.name, data.batchId ?? null, data.instrument, data.id],
      );
      return mapSampleQueue(row, []);
    }
    const row = await db.one<any>(
      `insert into public.sample_queues (name, batch_id, instrument, created_by)
       values ($1, $2, $3, $4) returning *`,
      [data.name, data.batchId ?? null, data.instrument, userId],
    );
    return mapSampleQueue(row, []);
  });

const QueueEntryInput = z.object({
  id: z.string().uuid().optional(),
  queueId: z.string().uuid(),
  position: z.number().int().default(0),
  sampleName: z.string().default(""),
  sampleType: z.enum(["unknown","blank","standard","qc","double_blank","system_suitability"]).default("unknown"),
  vialPosition: z.string().default(""),
  trayCode: z.string().default(""),
  methodPath: z.string().default(""),
  methodId: z.string().uuid().nullable().optional(),
  columnId: z.string().uuid().nullable().optional(),
  injectionVolume: z.number().default(0),
  dilutionFactor: z.number().default(1),
});

export const upsertSampleQueueEntry = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => QueueEntryInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (data.id) {
      const row = await db.one<any>(
        `update public.sample_queue_entries set position=$1, sample_name=$2, sample_type=$3,
         vial_position=$4, tray_code=$5, method_path=$6, method_id=$7, column_id=$8,
         injection_volume=$9, dilution_factor=$10 where id=$11 returning *`,
        [data.position, data.sampleName, data.sampleType, data.vialPosition,
         data.trayCode, data.methodPath, data.methodId ?? null, data.columnId ?? null,
         data.injectionVolume, data.dilutionFactor, data.id],
      );
      return mapSampleQueueEntry(row);
    }
    const row = await db.one<any>(
      `insert into public.sample_queue_entries
         (queue_id, position, sample_name, sample_type, vial_position, tray_code,
          method_path, method_id, column_id, injection_volume, dilution_factor)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [data.queueId, data.position, data.sampleName, data.sampleType, data.vialPosition,
       data.trayCode, data.methodPath, data.methodId ?? null, data.columnId ?? null,
       data.injectionVolume, data.dilutionFactor],
    );
    return mapSampleQueueEntry(row);
  });

const DeleteEntryInput = z.object({ id: z.string().uuid() });
export const deleteSampleQueueEntry = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeleteEntryInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.sample_queue_entries where id=$1", [data.id]);
    return { ok: true };
  });

const DeleteQueueInput = z.object({ id: z.string().uuid() });
export const deleteSampleQueue = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeleteQueueInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.sample_queues where id=$1", [data.id]);
    return { ok: true };
  });

// ---- SLD file import ----
const SldImportInput = z.object({
  queueId: z.string().uuid(),
  fileData: z.instanceof(ArrayBuffer),
});

export const importSldToQueue = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => SldImportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const entries = parseSldFileFromArrayBuffer(data.fileData);

    // Get existing entries to avoid duplicates (match by sample_name + position)
    const existing = await db.many<any>(
      "select sample_name, position from public.sample_queue_entries where queue_id=$1",
      [data.queueId],
    );
    const existingKeys = new Set(existing.map((e) => `${e.sample_name}|${e.position}`));

    let imported = 0;
    for (const entry of entries) {
      const key = `${entry.sampleName}|${entry.position}`;
      if (existingKeys.has(key)) continue;

      await db.query(
        `insert into public.sample_queue_entries
           (queue_id, position, sample_name, sample_type, vial_position, tray_code,
            method_path, injection_volume)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [data.queueId, entry.position, entry.sampleName, entry.sampleType,
         entry.vialPosition, entry.trayCode, entry.methodPath, entry.injectionVolume],
      );
      imported++;
    }

    return { imported, total: entries.length };
  });

// =====================================================================
// Method Templates CRUD
// =====================================================================

const TemplateInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().default(""),
  templateJson: z.any().default({}),
});

export const upsertMethodTemplate = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => TemplateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (data.id) {
      const row = await db.one<any>(
        `update public.method_templates set name=$1, description=$2, template_json=$3
         where id=$4 returning *`,
        [data.name, data.description, JSON.stringify(data.templateJson), data.id],
      );
      return mapMethodTemplate(row);
    }
    const row = await db.one<any>(
      `insert into public.method_templates (name, description, template_json, created_by)
       values ($1,$2,$3,$4) returning *`,
      [data.name, data.description, JSON.stringify(data.templateJson), userId],
    );
    return mapMethodTemplate(row);
  });

const DeleteTemplateInput = z.object({ id: z.string().uuid() });
export const deleteMethodTemplate = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeleteTemplateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.method_templates where id=$1", [data.id]);
    return { ok: true };
  });

// =====================================================================
// Custom Columns CRUD
// =====================================================================

const CustomColInput = z.object({
  id: z.string().uuid().optional(),
  methodId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  formula: z.string().min(1),
  unit: z.string().default(""),
  displayOrder: z.number().int().default(0),
});

export const upsertCustomColumn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => CustomColInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (data.id) {
      const row = await db.one<any>(
        `update public.custom_columns set method_id=$1, name=$2, formula=$3, unit=$4, display_order=$5
         where id=$6 returning *`,
        [data.methodId ?? null, data.name, data.formula, data.unit, data.displayOrder, data.id],
      );
      return mapCustomColumn(row);
    }
    const row = await db.one<any>(
      `insert into public.custom_columns (method_id, name, formula, unit, display_order, created_by)
       values ($1,$2,$3,$4,$5,$6) returning *`,
      [data.methodId ?? null, data.name, data.formula, data.unit, data.displayOrder, userId],
    );
    return mapCustomColumn(row);
  });

const DeleteCustomColInput = z.object({ id: z.string().uuid() });
export const deleteCustomColumn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeleteCustomColInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.custom_columns where id=$1", [data.id]);
    return { ok: true };
  });

// =====================================================================
// Import Watch Folders CRUD
// =====================================================================

const WatchFolderInput = z.object({
  id: z.string().uuid().optional(),
  path: z.string().min(1),
  enabled: z.boolean().default(true),
  methodId: z.string().uuid().nullable().optional(),
  columnId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  filePattern: z.string().default("*.mzXML"),
});

export const upsertWatchFolder = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => WatchFolderInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (data.id) {
      const row = await db.one<any>(
        `update public.import_watch_folders set path=$1, enabled=$2, method_id=$3,
         column_id=$4, batch_id=$5, file_pattern=$6 where id=$7 returning *`,
        [data.path, data.enabled, data.methodId ?? null, data.columnId ?? null,
         data.batchId ?? null, data.filePattern, data.id],
      );
      return mapImportWatchFolder(row);
    }
    const row = await db.one<any>(
      `insert into public.import_watch_folders (path, enabled, method_id, column_id, batch_id, file_pattern, created_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [data.path, data.enabled, data.methodId ?? null, data.columnId ?? null,
       data.batchId ?? null, data.filePattern, userId],
    );
    return mapImportWatchFolder(row);
  });

const DeleteWatchFolderInput = z.object({ id: z.string().uuid() });
export const deleteWatchFolder = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeleteWatchFolderInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    await db.query("delete from public.import_watch_folders where id=$1", [data.id]);
    return { ok: true };
  });

// =====================================================================
// Report Jobs (create only — email sending is in report-functions.ts
// to avoid pulling nodemailer into client bundles)
// =====================================================================

const ReportJobInput = z.object({
  id: z.string().uuid().optional(),
  title: z.string().min(1),
  template: z.string().default("standard"),
  runIds: z.array(z.string().uuid()).default([]),
  batchId: z.string().uuid().nullable().optional(),
  includeSections: z.array(z.string()).default([]),
  outputFormat: z.enum(["pdf","xlsx","csv"]).default("pdf"),
  emailTo: z.array(z.string().email()).default([]),
});

export const createReportJob = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ReportJobInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const row = await db.one<any>(
      `insert into public.report_jobs (title, template, run_ids, batch_id, include_sections,
         output_format, email_to, status, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,'pending',$8) returning *`,
      [data.title, data.template, data.runIds, data.batchId ?? null,
       data.includeSections, data.outputFormat, data.emailTo, userId],
    );
    return mapReportJob(row);
  });

// =====================================================================
// Buffer Exchange Events
// =====================================================================

const BufferExchangeInput = z.object({
  columnId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  kind: z.enum(["buffer_a", "buffer_b", "both", "solvent_lot", "mobile_phase_prep"]),
  oldDescription: z.string().default(""),
  newDescription: z.string().default(""),
  reason: z.string().default(""),
});

export const listBufferExchangeEvents = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ columnId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { db: Db };
    try {
      const rows = await db.many<any>(
        `select * from public.buffer_exchange_events where column_id=$1 order by created_at desc`,
        [data.columnId],
      );
      return rows.map(mapBufferExchangeEvent);
    } catch {
      return [];
    }
  });

export const logBufferExchange = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => BufferExchangeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; db: Db };
    const row = await db.one<any>(
      `insert into public.buffer_exchange_events
         (column_id, batch_id, kind, old_description, new_description, reason, performed_by)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [data.columnId, data.batchId ?? null, data.kind, data.oldDescription,
       data.newDescription, data.reason, userId],
    );
    return mapBufferExchangeEvent(row);
  });

export const deleteBufferExchangeEvent = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, isAdmin } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (!isAdmin) throw new Response("Forbidden — admin only", { status: 403 });
    await db.query("delete from public.buffer_exchange_events where id=$1", [data.id]);
    return { ok: true };
  });

const UpdateBufferExchangeInput = z.object({
  id: z.string().uuid(),
  performedBy: z.string().uuid().nullable().optional(),
});

export const updateBufferExchangeEvent = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => UpdateBufferExchangeInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db, isAdmin } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (!isAdmin) throw new Response("Forbidden — admin only", { status: 403 });
    const row = await db.maybe<any>(
      `update public.buffer_exchange_events set performed_by=$1 where id=$2 returning *`,
      [data.performedBy ?? null, data.id],
    );
    if (!row) throw new Response("Buffer exchange event not found", { status: 404 });
    return mapBufferExchangeEvent(row);
  });

// =====================================================================
// QC Runs
// =====================================================================

const QcRunInput = z.object({
  columnId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  methodId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  name: z.string().min(1),
  qcType: z.enum(["system_suitability", "column_qc", "batch_qc", "reference_standard"]).default("system_suitability"),
  filePath: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
  acquiredAt: z.string().optional(),
});

export const listQcRuns = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({
    columnId: z.string().uuid().optional(),
    batchId: z.string().uuid().optional(),
  }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { db } = context as { db: Db };
    const conditions: string[] = [];
    const params: any[] = [];
    if (data.columnId) { params.push(data.columnId); conditions.push(`column_id=$${params.length}`); }
    if (data.batchId) { params.push(data.batchId); conditions.push(`batch_id=$${params.length}`); }
    const where = conditions.length ? "where " + conditions.join(" and ") : "";
    try {
      const rows = await db.many<any>(
        `select * from public.qc_runs ${where} order by acquired_at desc`,
        params,
      );
      return rows.map(mapQcRun);
    } catch {
      return [];
    }
  });

export const createQcRun = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => QcRunInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; db: Db };
    const row = await db.one<any>(
      `insert into public.qc_runs
         (column_id, batch_id, method_id, run_id, name, qc_type, file_path, file_name, acquired_at, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [data.columnId ?? null, data.batchId ?? null, data.methodId ?? null, data.runId ?? null,
       data.name, data.qcType, data.filePath ?? null, data.fileName ?? null,
       data.acquiredAt ? new Date(data.acquiredAt).toISOString() : new Date().toISOString(),
       userId],
    );
    return mapQcRun(row);
  });

export const deleteQcRun = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db, isAdmin } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (!isAdmin) throw new Response("Forbidden — admin only", { status: 403 });
    await db.query("delete from public.qc_runs where id=$1", [data.id]);
    return { ok: true };
  });

const UpdateQcRunInput = z.object({
  id: z.string().uuid(),
  columnId: z.string().uuid().nullable().optional(),
  batchId: z.string().uuid().nullable().optional(),
  name: z.string().min(1).optional(),
  qcType: z.enum(["system_suitability", "column_qc", "batch_qc", "reference_standard"]).optional(),
});

export const updateQcRun = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => UpdateQcRunInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db, isAdmin } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    if (!isAdmin) throw new Response("Forbidden — admin only", { status: 403 });
    const sets: string[] = [];
    const params: any[] = [];
    if (data.columnId !== undefined) {
      params.push(data.columnId);
      sets.push(`column_id=$${params.length}`);
    }
    if (data.batchId !== undefined) {
      params.push(data.batchId);
      sets.push(`batch_id=$${params.length}`);
    }
    if (data.name !== undefined) {
      params.push(data.name);
      sets.push(`name=$${params.length}`);
    }
    if (data.qcType !== undefined) {
      params.push(data.qcType);
      sets.push(`qc_type=$${params.length}`);
    }
    if (sets.length === 0) {
      const row = await db.maybe<any>(`select * from public.qc_runs where id=$1`, [data.id]);
      if (!row) throw new Response("QC run not found", { status: 404 });
      return mapQcRun(row);
    }
    params.push(data.id);
    const row = await db.maybe<any>(
      `update public.qc_runs set ${sets.join(", ")} where id=$${params.length} returning *`,
      params,
    );
    if (!row) throw new Response("QC run not found", { status: 404 });
    return mapQcRun(row);
  });

// =====================================================================
// Anomaly Checks
// =====================================================================

const RunAnomalyInput = z.object({
  batchId: z.string().uuid().nullable().optional(),
  columnId: z.string().uuid().nullable().optional(),
});

export const runAnomalyChecks = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => RunAnomalyInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; db: Db };
    // Gather runs + peaks for the scope
    let runs: any[] = [];
    if (data.batchId) {
      runs = await db.many<any>(
        `select r.id, r.name, r.batch_id, r.column_id, r.acquired_at,
                r.method_id, r.file_path, r.file_format
         from public.runs r where r.batch_id=$1 order by r.acquired_at`,
        [data.batchId],
      );
    } else if (data.columnId) {
      runs = await db.many<any>(
        `select r.id, r.name, r.batch_id, r.column_id, r.acquired_at,
                r.method_id, r.file_path, r.file_format
         from public.runs r where r.column_id=$1 order by r.acquired_at`,
        [data.columnId],
      );
    } else {
      runs = await db.many<any>(`select r.id, r.name, r.batch_id, r.column_id, r.acquired_at, r.method_id, r.file_path, r.file_format from public.runs r order by r.acquired_at limit 200`);
    }

    // Fetch peaks for those runs
    const runIds = runs.map((r) => r.id);
    let peaksByRun = new Map<string, any[]>();
    if (runIds.length > 0) {
      const peaks = await db.many<any>(
        `select * from public.peaks where run_id = any($1::uuid[])`,
        [runIds],
      );
      for (const p of peaks) {
        const arr = peaksByRun.get(p.run_id) ?? [];
        arr.push({
          id: p.id, rt: Number(p.rt), area: Number(p.area ?? 0), height: Number(p.height ?? 0),
          fwhm: Number(p.fwhm ?? 0), sn: Number(p.sn ?? 0), mz: p.mz != null ? Number(p.mz) : undefined,
          analyteId: p.analyte_id ?? undefined, analyteName: p.analyte_name ?? undefined,
          asymmetry: p.asymmetry != null ? Number(p.asymmetry) : undefined,
        });
        peaksByRun.set(p.run_id, arr);
      }
    }

    const runsWithPeaks = runs.map((r) => ({
      id: r.id, name: r.name, batchId: r.batch_id, columnId: r.column_id,
      acquiredAt: String(r.acquired_at), peaks: peaksByRun.get(r.id) ?? [],
    }));

    // Fetch injections if column-scoped
    let injections: any[] = [];
    if (data.columnId) {
      injections = await db.many<any>(
        `select * from public.column_injections where column_id=$1 order by injection_num`,
        [data.columnId],
      );
    }

    // Fetch QC samples if batch-scoped
    let qcSamples: any[] = [];
    if (data.batchId) {
      try {
        qcSamples = await db.many<any>(
          `select qs.* from public.qc_samples qs
           join public.calibration_curves cc on cc.id = qs.curve_id
           where cc.batch_id = $1`,
          [data.batchId],
        );
      } catch { /* qc_samples may not have batch link */ }
    }

    // Fetch batch info
    let batch: any = null;
    if (data.batchId) {
      batch = await db.maybe<any>(`select * from public.batches where id=$1`, [data.batchId]);
    }

    const newChecks = runAllAnomalyChecks({
      scope: data.batchId ? "batch" : "qc",
      batchId: data.batchId ?? null,
      columnId: data.columnId ?? null,
      runs: runsWithPeaks,
      injections: injections.map((i) => ({
        id: i.id, columnId: i.column_id, runId: i.run_id ?? null, methodId: i.method_id ?? null,
        sequenceName: i.sequence_name, injectionNum: i.injection_num,
        startingPressure: i.starting_pressure != null ? Number(i.starting_pressure) : null,
        notes: i.notes ?? "", performedBy: i.performed_by ?? null, createdAt: String(i.created_at),
      })),
      qcSamples: qcSamples.map((q) => ({
        id: q.id, expectedConc: Number(q.expected_conc),
        measuredConc: q.measured_conc != null ? Number(q.measured_conc) : null,
        accuracyPct: q.accuracy_pct != null ? Number(q.accuracy_pct) : null,
        passed: q.passed,
      })),
      batch: batch ? {
        id: batch.id, name: batch.name, project: batch.project ?? "",
        startedAt: String(batch.started_at), sampleCount: 0, runIds: [],
        status: batch.status ?? "in_progress", owner: batch.owner_id ?? "",
        notes: batch.notes ?? "",
      } : null,
    });

    // Persist checks
    const saved: any[] = [];
    for (const check of newChecks) {
      const row = await db.one<any>(
        `insert into public.anomaly_checks
           (scope, scope_id, batch_id, column_id, check_type, severity, message, metrics_json, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [check.scope, check.scopeId, check.batchId, check.columnId,
         check.checkType, check.severity, check.message, JSON.stringify(check.metricsJson), userId],
      );
      saved.push(mapAnomalyCheck(row));
    }
    return saved;
  });

const ListAnomalyInput = z.object({
  scope: z.enum(["batch", "sample", "compound", "qc"]).optional(),
  batchId: z.string().uuid().optional(),
  columnId: z.string().uuid().optional(),
  resolved: z.boolean().optional(),
});

export const listAnomalyChecks = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ListAnomalyInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { db } = context as { db: Db };
    const conditions: string[] = [];
    const params: any[] = [];
    if (data.scope) { params.push(data.scope); conditions.push(`scope=$${params.length}`); }
    if (data.batchId) { params.push(data.batchId); conditions.push(`batch_id=$${params.length}`); }
    if (data.columnId) { params.push(data.columnId); conditions.push(`column_id=$${params.length}`); }
    if (data.resolved != null) { params.push(data.resolved); conditions.push(`resolved=$${params.length}`); }
    const where = conditions.length ? "where " + conditions.join(" and ") : "";
    try {
      const rows = await db.many<any>(
        `select * from public.anomaly_checks ${where} order by created_at desc limit 500`,
        params,
      );
      return rows.map(mapAnomalyCheck);
    } catch {
      return [];
    }
  });

export const resolveAnomalyCheck = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; db: Db };
    const row = await db.one<any>(
      `update public.anomaly_checks set resolved=true, resolved_by=$1, resolved_at=now()
       where id=$2 returning *`,
      [userId, data.id],
    );
    return mapAnomalyCheck(row);
  });

// =====================================================================
// Column History (unified timeline)
// =====================================================================

export const getColumnHistory = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ columnId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { db: Db };
    const { columnId } = data;
    const timeline: any[] = [];

    // 1. Audit events for the columns table itself
    let colAudits: any[] = [];
    try {
      colAudits = await db.many<any>(
        `select ae.*, u.email as actor_email, p.display_name as actor_name
         from public.audit_events ae
         left join public.app_users u on u.id = ae.actor_id
         left join public.profiles p on p.id = u.id
         where ae.table_name = 'columns' and ae.row_id = $1
         order by ae.created_at desc`,
        [columnId],
      );
    } catch {}
    for (const a of colAudits) {
      const diff = a.diff ?? {};
      let summary = `${a.action} column`;
      if (a.action === "update" && diff.after && diff.before) {
        const changed: string[] = [];
        const before = diff.before as Record<string, any>;
        const after = diff.after as Record<string, any>;
        for (const key of ["name", "manufacturer", "chemistry", "dimensions", "particle_size", "serial", "status", "notes_md"]) {
          if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
            changed.push(`${key}: "${before[key] ?? ""}" → "${after[key] ?? ""}"`);
          }
        }
        if (changed.length > 0) summary = `Updated: ${changed.join(", ")}`;
      }
      timeline.push({
        id: `audit-${a.id}`,
        source: "audit",
        action: a.action,
        tableName: a.table_name,
        summary,
        actorId: a.actor_id,
        actorName: a.actor_name ?? a.actor_email ?? null,
        diff: a.diff,
        createdAt: String(a.created_at),
      });
    }

    // 2. Column service events (direct fetch for current state)
    let serviceEvents: any[] = [];
    try {
      serviceEvents = await db.many<any>(
        `select cse.*, u.email as actor_email, p.display_name as actor_name
         from public.column_service_events cse
         left join public.app_users u on u.id = cse.performed_by
         left join public.profiles p on p.id = u.id
         where cse.column_id = $1 order by cse.created_at desc`,
        [columnId],
      );
    } catch {}
    for (const e of serviceEvents) {
      const kindLabel: Record<string, string> = {
        reset: "Injection count reset", guard_change: "Guard cartridge change",
        maintenance: "Maintenance", install: "New column installed",
      };
      timeline.push({
        id: `service-${e.id}`,
        source: "service_event",
        action: "create",
        tableName: "column_service_events",
        summary: `${kindLabel[e.kind] ?? e.kind}${e.reset_usage ? ` (${e.injections_before} → ${e.injections_after} inj)` : ""}${e.serial ? ` S/N ${e.serial}` : ""}${e.notes ? ` — ${e.notes}` : ""}`,
        actorId: e.performed_by,
        actorName: e.actor_name ?? e.actor_email ?? null,
        diff: { kind: e.kind, injectionsBefore: e.injections_before, injectionsAfter: e.injections_after, serial: e.serial, notes: e.notes, resetUsage: e.reset_usage },
        createdAt: String(e.created_at),
      });
    }

    // 3. Buffer exchange events
    let bufferEvents: any[] = [];
    try {
      bufferEvents = await db.many<any>(
        `select bee.*, u.email as actor_email, p.display_name as actor_name
         from public.buffer_exchange_events bee
         left join public.app_users u on u.id = bee.performed_by
         left join public.profiles p on p.id = u.id
         where bee.column_id = $1 order by bee.created_at desc`,
        [columnId],
      );
    } catch {}
    for (const e of bufferEvents) {
      const kindLabel: Record<string, string> = {
        buffer_a: "Buffer A change", buffer_b: "Buffer B change",
        both: "Both buffers changed", solvent_lot: "Solvent lot change",
        mobile_phase_prep: "Mobile phase prep",
      };
      timeline.push({
        id: `buffer-${e.id}`,
        source: "buffer_exchange",
        action: "create",
        tableName: "buffer_exchange_events",
        summary: `${kindLabel[e.kind] ?? e.kind}${e.old_description || e.new_description ? `: ${e.old_description || "—"} → ${e.new_description || "—"}` : ""}${e.old_lot || e.new_lot ? ` (lot ${e.old_lot || "—"} → ${e.new_lot || "—"})` : ""}${e.reason ? ` — ${e.reason}` : ""}`,
        actorId: e.performed_by,
        actorName: e.actor_name ?? e.actor_email ?? null,
        diff: { kind: e.kind, oldDescription: e.old_description, newDescription: e.new_description, oldLot: e.old_lot, newLot: e.new_lot, reason: e.reason },
        createdAt: String(e.created_at),
      });
    }

    // 4. Column injections
    // 4. Column injections
    let injections: any[] = [];
    try {
      injections = await db.many<any>(
        `select ci.*, u.email as actor_email, p.display_name as actor_name
         from public.column_injections ci
         left join public.app_users u on u.id = ci.performed_by
         left join public.profiles p on p.id = u.id
         where ci.column_id = $1 order by ci.created_at desc`,
        [columnId],
      );
    } catch {}
    for (const i of injections) {
      timeline.push({
        id: `inj-${i.id}`,
        source: "injection",
        action: "log",
        tableName: "column_injections",
        summary: `Injection #${i.injection_num}${i.sequence_name ? ` (${i.sequence_name})` : ""}${i.starting_pressure != null ? ` — ${i.starting_pressure} bar` : ""}${i.notes ? ` — ${i.notes}` : ""}`,
        actorId: i.performed_by,
        actorName: i.actor_name ?? i.actor_email ?? null,
        diff: { injectionNum: i.injection_num, sequenceName: i.sequence_name, startingPressure: i.starting_pressure, notes: i.notes },
        createdAt: String(i.created_at),
      });
    }

    // 5. QC runs
    let qcRuns: any[] = [];
    try {
      qcRuns = await db.many<any>(
        `select qr.*, u.email as actor_email, p.display_name as actor_name
         from public.qc_runs qr
         left join public.app_users u on u.id = qr.uploaded_by
         left join public.profiles p on p.id = u.id
         where qr.column_id = $1 order by qr.created_at desc`,
        [columnId],
      );
    } catch {}
    for (const q of qcRuns) {
      timeline.push({
        id: `qc-${q.id}`,
        source: "qc_run",
        action: "create",
        tableName: "qc_runs",
        summary: `QC run uploaded: "${q.name}" (${q.qc_type})${q.file_name ? ` — ${q.file_name}` : ""}`,
        actorId: q.uploaded_by,
        actorName: q.actor_name ?? q.actor_email ?? null,
        diff: { name: q.name, qcType: q.qc_type, fileName: q.file_name, acquiredAt: q.acquired_at },
        createdAt: String(q.created_at),
      });
    }

    // Sort by createdAt descending
    timeline.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return timeline;
  });
