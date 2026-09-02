import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import type { Db } from "@/db/index.server";
import {
  mapSampleQueue, mapSampleQueueEntry, mapMethodTemplate,
  mapReportJob, mapCustomColumn, mapImportWatchFolder,
  mapImportedFile, mapISAssignment,
} from "@/lib/lab-data.server";
import { parseSldFileFromArrayBuffer } from "@/lib/sld-import";
import { sendEmail } from "@/lib/email.server";

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
// Report Jobs
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

const SendReportEmailInput = z.object({
  id: z.string().uuid(),
  to: z.array(z.string().email()),
  subject: z.string().default(""),
  body: z.string().default(""),
});

export const sendReportEmail = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => SendReportEmailInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const job = await db.one<any>(
      "select * from public.report_jobs where id=$1", [data.id],
    );
    if (!job.storage_path) throw new Error("Report file not found.");

    try {
      const toStr = data.to.join(", ");
      await sendEmail({
        to: toStr,
        subject: data.subject || job.title,
        html: data.body || `<p>Report: ${job.title}</p>`,
        text: data.body || `Report: ${job.title}`,
      });
      await db.query(
        "update public.report_jobs set email_sent_at=now(), email_to=$1, status='sent' where id=$2",
        [data.to, data.id],
      );
      return { ok: true };
    } catch (e: any) {
      await db.query(
        "update public.report_jobs set status='failed' where id=$1", [data.id],
      );
      throw new Error(`Email send failed: ${e?.message ?? "unknown error"}`);
    }
  });

const UpdateReportStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending","generating","ready","sent","failed"]),
  storagePath: z.string().nullable().optional(),
});

export const updateReportStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => UpdateReportStatusInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: Db };
    const row = await db.one<any>(
      `update public.report_jobs set status=$1, storage_path=coalesce($2, storage_path)
       where id=$3 returning *`,
      [data.status, data.storagePath ?? null, data.id],
    );
    return mapReportJob(row);
  });
