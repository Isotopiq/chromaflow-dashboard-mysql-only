import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import { withAdmin } from "@/db/index.server";
import {
  createSignedUploadUrl,
  createSignedDownloadUrl,
  downloadObject,
  removeObjects,
  type BucketName,
} from "@/lib/storage.server";
import { mzFromFormula } from "./chem";
import {
  fetchAllForUser,
  getCurrentUserProfile,
  mapMethod,
  mapColumn,
  mapBatch,
  mapAnalyte,
  mapRun,
  mapPeak,
  listAllUsersAdmin,
  setUserRoleAdmin,
} from "./lab-data.server";

// ---- Bootstrap: load everything for the current user ----
export const loadAll = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { userId, email, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const [data, currentUser] = await Promise.all([
      fetchAllForUser(db),
      getCurrentUserProfile(db, userId, email),
    ]);
    return { ...data, currentUser };
  });

// ---- Methods ----
const MethodInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  modality: z.enum(["RP-LC-MS", "HILIC-MS", "IEX", "SEC"]),
  columnId: z.string().optional().nullable(),
  status: z.enum(["draft", "validated", "archived"]).default("draft"),
  mobilePhaseA: z.string().max(500).default(""),
  mobilePhaseB: z.string().max(500).default(""),
  gradient: z
    .array(z.object({
      time: z.number().min(0).max(120),
      pctB: z.number().min(0).max(100),
      flow: z.number().min(0).max(5),
    }))
    .max(50),
  flowRate: z.number().min(0).max(5).default(0.3),
  columnTemp: z.number().min(0).max(120).default(30),
  injectionVolume: z.number().min(0).max(1000).default(2),
  detector: z.string().max(500).default(""),
  msIonization: z.enum(["ESI+", "ESI-", "APCI+", "APCI-"]).default("ESI+"),
  msScanRange: z.tuple([z.number(), z.number()]).default([100, 1200]),
  notes: z.string().max(5000).default(""),
  tags: z.array(z.string().max(50)).max(20).default([]),
});

export const upsertMethod = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => MethodInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const msParams = {
      mobilePhaseA: data.mobilePhaseA,
      mobilePhaseB: data.mobilePhaseB,
      flowRate: data.flowRate,
      columnTemp: data.columnTemp,
      injectionVolume: data.injectionVolume,
      detector: data.detector,
      msIonization: data.msIonization,
      msScanRange: data.msScanRange,
      tags: data.tags,
    };
    let row;
    if (data.id) {
      row = await db.one(
        `update public.methods set
           name=$1, modality=$2, column_id=$3, gradient_json=$4, ms_params_json=$5,
           notes_md=$6, status=$7, updated_at=now()
         where id=$8 returning *`,
        [data.name, data.modality, data.columnId || null, JSON.stringify(data.gradient),
         JSON.stringify(msParams), data.notes, data.status, data.id],
      );
    } else {
      row = await db.one(
        `insert into public.methods
           (name, modality, column_id, gradient_json, ms_params_json, notes_md, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [data.name, data.modality, data.columnId || null, JSON.stringify(data.gradient),
         JSON.stringify(msParams), data.notes, data.status, userId],
      );
    }
    return mapMethod(row);
  });

// ---- Columns ----
const ColumnInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  chemistry: z.string().max(200).default(""),
  dimensions: z.string().max(100).default(""),
  particleSize: z.string().max(50).default(""),
  serial: z.string().max(100).default(""),
  ratedInjections: z.number().int().min(0).max(100000).default(1000),
  usedInjections: z.number().int().min(0).default(0),
  status: z.enum(["healthy", "warn", "expired"]).default("healthy"),
  notes: z.string().max(5000).default(""),
});

export const upsertColumn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ColumnInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    let row;
    if (data.id) {
      row = await db.one(
        `update public.columns set
           name=$1, chemistry=$2, dimensions=$3, particle_size=$4, serial=$5,
           rated_injections=$6, used_injections=$7, status=$8, notes_md=$9, updated_at=now()
         where id=$10 returning *`,
        [data.name, data.chemistry, data.dimensions, data.particleSize, data.serial,
         data.ratedInjections, data.usedInjections, data.status, data.notes, data.id],
      );
    } else {
      row = await db.one(
        `insert into public.columns
           (name, chemistry, dimensions, particle_size, serial, rated_injections,
            used_injections, status, notes_md, owner_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
        [data.name, data.chemistry, data.dimensions, data.particleSize, data.serial,
         data.ratedInjections, data.usedInjections, data.status, data.notes, userId],
      );
    }
    return mapColumn(row);
  });

export const deleteColumn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const existing = await db.maybe<any>(
      "select id, owner_id from public.columns where id = $1", [data.id]);
    if (!existing) return { ok: true, missing: true };
    if (existing.owner_id && existing.owner_id !== userId && !isAdmin)
      throw new Error("You can only delete columns you own.");
    const refsM = await db.maybe<any>(
      "select id from public.methods where column_id = $1 limit 1", [data.id]);
    const refsR = await db.maybe<any>(
      "select id from public.runs where column_id = $1 limit 1", [data.id]);
    if (refsM || refsR)
      throw new Error("Column is still referenced by methods or runs. Unlink them before deleting.");
    await db.query("delete from public.columns where id = $1", [data.id]);
    return { ok: true };
  });

// ---- Batches ----
const BatchInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  project: z.string().max(200).default(""),
});
export const upsertBatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => BatchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    let row;
    if (data.id) {
      row = await db.one(
        "update public.batches set name=$1, project=$2 where id=$3 returning *",
        [data.name, data.project, data.id]);
    } else {
      row = await db.one(
        "insert into public.batches (name, project, owner_id) values ($1,$2,$3) returning *",
        [data.name, data.project, userId]);
    }
    return mapBatch(row, []);
  });

// ---- Analytes ----
const AnalyteInput = z.object({
  name: z.string().min(1).max(200),
  formula: z.string().max(100).default(""),
  mz: z.number().min(0).max(10000).optional().nullable(),
  rtExpected: z.number().min(0).max(120),
});
export const addAnalyte = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => AnalyteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    let mz = data.mz ?? null;
    if (mz == null || mz <= 0) {
      const computed = data.formula ? mzFromFormula(data.formula, "[M+H]+") : null;
      if (computed == null) throw new Error("Provide a valid molecular formula or a manual m/z.");
      mz = computed;
    }
    const row = await db.one(
      `insert into public.analytes (name, formula, mz, rt_expected, library_source, created_by)
       values ($1,$2,$3,$4,'user',$5) returning *`,
      [data.name, data.formula, mz, data.rtExpected, userId],
    );
    return mapAnalyte(row);
  });

const UpdateAnalyteInput = AnalyteInput.extend({ id: z.string() });
export const updateAnalyte = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => UpdateAnalyteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const existing = await db.maybe<any>(
      "select id, created_by from public.analytes where id = $1", [data.id]);
    if (!existing) throw new Error("Compound not found.");
    if (existing.created_by && existing.created_by !== userId && !isAdmin)
      throw new Error("You can only edit compounds you created.");
    let mz = data.mz ?? null;
    if (mz == null || mz <= 0) {
      const computed = data.formula ? mzFromFormula(data.formula, "[M+H]+") : null;
      if (computed == null) throw new Error("Provide a valid molecular formula or a manual m/z.");
      mz = computed;
    }
    const row = await db.one(
      `update public.analytes set name=$1, formula=$2, mz=$3, rt_expected=$4
       where id=$5 returning *`,
      [data.name, data.formula, mz, data.rtExpected, data.id],
    );
    return mapAnalyte(row);
  });

export const deleteAnalyte = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const existing = await db.maybe<any>(
      "select id, created_by from public.analytes where id = $1", [data.id]);
    if (!existing) return { ok: true, missing: true };
    if (existing.created_by && existing.created_by !== userId && !isAdmin)
      throw new Error("You can only delete compounds you created.");
    await db.query("update public.peaks set analyte_id = null where analyte_id = $1", [data.id]);
    await db.query("delete from public.analytes where id = $1", [data.id]);
    return { ok: true };
  });

// ---- Runs ----
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
  })).max(1000),
});

export const findRunByFilePath = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ filePath: z.string().min(1).max(500) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const run = await db.maybe<any>(
      `select * from public.runs
       where file_path=$1 and uploaded_by=$2
       order by acquired_at desc limit 1`,
      [data.filePath, userId],
    );
    if (!run) return { run: null };
    const peakRows = await db.many<any>(
      "select * from public.peaks where run_id=$1", [run.id]);
    return { run: mapRun(run, peakRows.map(mapPeak).sort((a: any, b: any) => a.rt - b.rt)) };
  });

export const createRun = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => RunInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const summary = {
      name: data.name,
      fileSize: data.fileSize,
      ionMode: data.ionMode,
      trace: data.trace,
    };
    const run = await db.one<any>(
      `insert into public.runs
        (method_id, column_id, batch_id, file_path, file_format, scans_blob_path,
         ms_level, parsed_status, summary_json, uploaded_by)
       values ($1,$2,$3,$4,$5,$6,$7,'parsed',$8,$9) returning *`,
      [
        data.methodId || null, data.columnId || null, data.batchId || null,
        data.filePath, data.fileFormat, data.scansBlobPath || null, data.msLevel,
        JSON.stringify(summary), userId,
      ],
    );
    let peakRows: any[] = [];
    for (const p of data.peaks) {
      const r = await db.one<any>(
        `insert into public.peaks (run_id, rt, area, height, fwhm, sn, mz, mz_low, mz_high)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [run.id, p.rt, p.area, p.height, p.fwhm, p.sn,
         p.mz ?? null, p.mzLow ?? null, p.mzHigh ?? null],
      );
      peakRows.push(r);
    }
    return mapRun(run, peakRows.map(mapPeak));
  });

const AnnotateInput = z.object({
  runId: z.string(),
  peakId: z.string(),
  analyteId: z.string().optional().nullable(),
  label: z.string().max(200).optional(),
});
export const annotatePeak = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => AnnotateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    await db.query(
      `update public.peaks set
         analyte_id=$1, annotated_by=$2, annotation_source='manual', confidence=1
       where id=$3`,
      [data.analyteId ?? null, userId, data.peakId],
    );
    if (data.label) {
      await db.query(
        "insert into public.annotations (run_id, peak_id, label, author_id) values ($1,$2,$3,$4)",
        [data.runId, data.peakId, data.label, userId],
      );
    }
    return { ok: true };
  });

const UnassignInput = z.object({
  runId: z.string(),
  peakIds: z.array(z.string()).min(1).max(500),
});
export const unassignPeaks = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => UnassignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    await db.query(
      `update public.peaks set
         analyte_id=null, analyte_name=null, annotated_by=null,
         annotation_source=null, confidence=null
       where id = any($1::uuid[])`,
      [data.peakIds],
    );
    return { ok: true, count: data.peakIds.length };
  });

// ---- EIC ----
const EICInput = z.object({
  runId: z.string(),
  mz: z.number().min(0).max(10000),
  ppm: z.number().min(1).max(200).default(10),
});
export const getRunEIC = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => EICInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const run = await db.maybe<any>(
      "select scans_blob_path from public.runs where id=$1", [data.runId]);
    if (!run?.scans_blob_path) {
      throw new Error("EIC unavailable: this run has no saved scan data. Re-upload the raw file to enable EIC extraction.");
    }
    const buf = await downloadObject("raw-runs", run.scans_blob_path);
    if (buf.byteLength === 0) {
      throw new Error("EIC unavailable: the saved scan data is empty. Re-upload the raw file and try again.");
    }
    const { extractEICFromBlob } = await import("./eic");
    const trace = extractEICFromBlob(buf, data.mz, data.ppm);
    if (trace.x.length === 0) {
      throw new Error("EIC unavailable: no MS1 scans were found in the saved scan data.");
    }
    return trace;
  });

const EICBatchInput = z.object({
  runId: z.string(),
  ppm: z.number().min(1).max(200).default(10),
  targets: z.array(z.object({ id: z.string().max(80), mz: z.number().min(0).max(10000) })).min(1).max(50),
});
export const getRunEICBatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => EICBatchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const run = await db.maybe<any>(
      "select scans_blob_path from public.runs where id=$1", [data.runId]);
    if (!run?.scans_blob_path) {
      throw new Error("Auto-XIC unavailable: this run has no saved scan data. Re-upload the raw file to enable XIC extraction.");
    }
    const buf = await downloadObject("raw-runs", run.scans_blob_path);
    if (buf.byteLength === 0) {
      throw new Error("Auto-XIC unavailable: the saved scan data is empty. Re-upload the raw file and try again.");
    }
    const { unpackScans, extractEIC } = await import("./eic");
    const scans = unpackScans(buf);
    if (scans.length === 0) {
      throw new Error("Auto-XIC unavailable: no MS1 scans were found in the saved scan data.");
    }
    const x = scans.map((s) => s.rt);
    const traces = data.targets.map((t) => {
      const tr = extractEIC(scans, t.mz, data.ppm);
      const y = tr.y; const xs = tr.x;
      let peakIdx = -1; let peakInt = 0;
      for (let i = 0; i < y.length; i++) { if (y[i] > peakInt) { peakInt = y[i]; peakIdx = i; } }
      let fwhm = 0, area = 0, sn = 0;
      if (peakIdx >= 0 && peakInt > 0) {
        const half = peakInt / 2;
        let l = peakIdx; while (l > 0 && y[l] > half) l--;
        let r = peakIdx; while (r < y.length - 1 && y[r] > half) r++;
        fwhm = Math.max(0, xs[r] - xs[l]);
        const cut = peakInt * 0.05;
        let al = peakIdx; while (al > 0 && y[al] > cut) al--;
        let ar = peakIdx; while (ar < y.length - 1 && y[ar] > cut) ar++;
        for (let i = al; i < ar; i++) area += ((y[i] + y[i + 1]) / 2) * (xs[i + 1] - xs[i]);
        const noise: number[] = [];
        for (let i = 0; i < y.length; i++) if (i < al || i > ar) noise.push(y[i]);
        let med = 0;
        if (noise.length > 0) { noise.sort((a, b) => a - b); med = noise[Math.floor(noise.length / 2)]; }
        sn = peakInt / Math.max(1, med);
      }
      return {
        id: t.id, mz: t.mz, y, mzLow: tr.mzLow, mzHigh: tr.mzHigh,
        peakRt: peakIdx >= 0 ? xs[peakIdx] : null,
        peakIntensity: peakInt, area, height: peakInt, fwhm, sn,
      };
    });
    return { x, traces };
  });

// ---- Admin ----
export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { isAdmin } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    return listAllUsersAdmin();
  });

const SetRoleInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "developer", "reviewer"]),
});
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => SetRoleInput.parse(d))
  .handler(async ({ data, context }) => {
    const { isAdmin } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    await setUserRoleAdmin(data.userId, data.role);
    return { ok: true };
  });

// ---- Storage signed-upload ----
const UploadUrlInput = z.object({
  filename: z.string().min(1).max(300),
  bucket: z.enum(["raw-runs", "reports", "branding", "avatars"]).default("raw-runs"),
  suffix: z.string().max(40).optional(),
  contentType: z.string().max(120).optional(),
});

export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => UploadUrlInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stamp = Date.now();
    const path = `${userId}/${stamp}-${safe}${data.suffix ?? ""}`;
    const { url } = await createSignedUploadUrl(
      data.bucket as BucketName, path,
      data.contentType ?? "application/octet-stream",
    );
    // `token` retained for client-side API compatibility (unused with raw PUT).
    return { path, token: "", signedUrl: url, bucket: data.bucket };
  });

// ---- Reports ----
const ReportInput = z.object({
  title: z.string().min(1).max(200),
  template: z.enum(["run", "batch", "method"]),
  runIds: z.array(z.string().uuid()).max(50).default([]),
  batchId: z.string().uuid().optional().nullable(),
  storagePath: z.string().min(1).max(500),
});
export const createReport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ReportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const saved = await db.one<any>(
      `insert into public.reports (title, template, run_ids, batch_id, storage_path, created_by)
       values ($1,$2,$3::uuid[],$4,$5,$6) returning *`,
      [data.title, data.template, data.runIds, data.batchId ?? null, data.storagePath, userId],
    );
    return { ...saved, metadataComplete: true };
  });

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    return db.many("select * from public.reports order by created_at desc");
  });

export const getReportSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const row = await db.one<any>(
      "select storage_path from public.reports where id=$1", [data.id]);
    if (!row?.storage_path) throw new Error("This report has no stored PDF path.");
    const url = await createSignedDownloadUrl("reports", row.storage_path, 60 * 10);
    return { url };
  });

export const deleteReport = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const row = await db.maybe<any>(
      "select storage_path from public.reports where id=$1", [data.id]);
    if (row?.storage_path) await removeObjects("reports", [row.storage_path]);
    await db.query("delete from public.reports where id=$1", [data.id]);
    return { ok: true };
  });

// ---- Sharing links ----
const ShareInput = z.object({
  resourceKind: z.enum(["run", "report"]),
  resourceId: z.string().uuid(),
  expiresInHours: z.number().int().min(1).max(24 * 365).default(168),
});
export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ShareInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const token = crypto.randomUUID().replace(/-/g, "");
    const expires = new Date(Date.now() + data.expiresInHours * 3_600_000).toISOString();
    const row = await db.one<any>(
      `insert into public.shared_links (token, resource_kind, resource_id, expires_at, created_by)
       values ($1,$2,$3,$4,$5) returning *`,
      [token, data.resourceKind, data.resourceId, expires, userId],
    );
    return { token: row.token, expiresAt: row.expires_at };
  });

// Public share (no auth). Uses admin bypass.
export const getSharedResource = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ token: z.string().min(8).max(80) }).parse(d))
  .handler(async ({ data }) => {
    return withAdmin(async (db) => {
      const link = await db.maybe<any>(
        "select * from public.shared_links where token=$1", [data.token]);
      if (!link) throw new Error("Link not found");
      if (link.expires_at && new Date(link.expires_at).getTime() < Date.now())
        throw new Error("Link has expired");

      if (link.resource_kind === "report") {
        const report = await db.maybe<any>(
          "select id, title, template, storage_path, created_at from public.reports where id=$1",
          [link.resource_id]);
        if (!report) throw new Error("Report not found");
        const url = await createSignedDownloadUrl("reports", report.storage_path, 60 * 10);
        return {
          kind: "report" as const,
          title: report.title, template: report.template,
          createdAt: report.created_at, url,
        };
      }

      const run = await db.maybe<any>(
        "select * from public.runs where id=$1", [link.resource_id]);
      if (!run) throw new Error("Run not found");
      const peaks = await db.many<any>(
        "select * from public.peaks where run_id=$1", [run.id]);
      return {
        kind: "run" as const,
        run: mapRun(run, peaks.map(mapPeak).sort((a: any, b: any) => a.rt - b.rt)),
      };
    });
  });

// ---- Audit log (admin) ----
const AuditFilters = z.object({
  table: z.string().max(80).optional(),
  action: z.enum(["insert", "update", "delete"]).optional(),
  actorId: z.string().uuid().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
function buildAuditWhere(data: z.infer<typeof AuditFilters>) {
  const wh: string[] = [];
  const params: any[] = [];
  const push = (sql: string, v: any) => { params.push(v); wh.push(sql.replace("?", `$${params.length}`)); };
  if (data.table) push("table_name = ?", data.table);
  if (data.action) push("action = ?", data.action);
  if (data.actorId) push("actor_id = ?", data.actorId);
  if (data.since) push("created_at >= ?", data.since);
  if (data.until) push("created_at <= ?", data.until);
  return { wh, params };
}
export const listAuditEvents = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => AuditFilters.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    const { isAdmin, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    const { wh, params } = buildAuditWhere(data);
    const whereSql = wh.length ? "where " + wh.join(" and ") : "";
    const countRow = await db.maybe<{ count: string }>(
      `select count(*)::text as count from public.audit_events ${whereSql}`,
      params,
    );
    const total = Number(countRow?.count ?? 0);
    const listParams = [...params, data.limit, data.offset];
    const rows = await db.many(
      `select * from public.audit_events ${whereSql}
       order by created_at desc
       limit $${listParams.length - 1} offset $${listParams.length}`,
      listParams,
    );
    return { rows, total };
  });

const DeleteAuditInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});
export const deleteAuditEvents = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => DeleteAuditInput.parse(d))
  .handler(async ({ data, context }) => {
    const { isAdmin } = context as { isAdmin: boolean };
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    return withAdmin(async (db) => {
      const res = await db.query(
        "delete from public.audit_events where id = any($1::uuid[])",
        [data.ids],
      );
      return { deleted: res.rowCount ?? 0 };
    });
  });

export const resetAuditEvents = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { isAdmin } = context as { isAdmin: boolean };
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    return withAdmin(async (db) => {
      const res = await db.query("delete from public.audit_events");
      return { deleted: res.rowCount ?? 0 };
    });
  });

// ---- Auto-annotate batch ----
const AutoAnnotateInput = z.object({
  batchId: z.string().uuid(),
  rtTolMin: z.number().min(0).max(5).default(0.3),
  ppmTol: z.number().min(0).max(200).default(10),
});
export const autoAnnotateBatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => AutoAnnotateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const runs = await db.many<any>(
      "select id from public.runs where batch_id=$1", [data.batchId]);
    if (runs.length === 0) return { annotated: 0, scanned: 0 };
    const analytes = await db.many<any>(
      "select id, name, mz, rt_expected from public.analytes");
    const runIds = runs.map((r) => r.id);
    const peaks = await db.many<any>(
      "select id, rt, mz, run_id from public.peaks where run_id = any($1::uuid[])",
      [runIds]);
    let annotated = 0;
    for (const p of peaks) {
      let bestScore = Infinity; let bestA: any = null;
      for (const a of analytes) {
        const dRt = Math.abs(p.rt - Number(a.rt_expected));
        if (dRt > data.rtTolMin) continue;
        const dPpm = p.mz != null
          ? Math.abs((Number(p.mz) - Number(a.mz)) / Number(a.mz)) * 1e6 : 999;
        if (dPpm > data.ppmTol) continue;
        const score = dRt * 10 + dPpm;
        if (score < bestScore) { bestScore = score; bestA = a; }
      }
      if (bestA) {
        await db.query(
          `update public.peaks set
             analyte_id=$1, annotated_by=$2, annotation_source='auto', confidence=$3
           where id=$4`,
          [bestA.id, userId, Math.max(0.5, 1 - bestScore / 50), p.id]);
        annotated++;
      }
    }
    return { annotated, scanned: peaks.length };
  });

// ---- Manual peak ----
const ManualPeakInput = z.object({
  runId: z.string().uuid(),
  rt: z.number(),
  rtStart: z.number(),
  rtEnd: z.number(),
  area: z.number().min(0),
  height: z.number().min(0),
  fwhm: z.number().min(0),
  sn: z.number().min(0),
  mz: z.number().nullable().optional(),
  mzLow: z.number().nullable().optional(),
  mzHigh: z.number().nullable().optional(),
  analyteId: z.string().uuid().nullable().optional(),
  analyteName: z.string().max(200).nullable().optional(),
});
export const addManualPeak = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => ManualPeakInput.parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const run = await db.maybe<any>(
      "select id, uploaded_by from public.runs where id=$1", [data.runId]);
    if (!run) throw new Error("Run not found");
    if (run.uploaded_by && run.uploaded_by !== userId)
      throw new Error("You don't have permission to add peaks to this run.");
    const hasAnalyte = !!(data.analyteId || data.analyteName);
    const row = await db.one<any>(
      `insert into public.peaks (
         run_id, rt, area, height, fwhm, sn, mz, mz_low, mz_high,
         analyte_id, analyte_name, annotated_by, annotation_source, confidence, manual
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,true) returning *`,
      [
        data.runId, data.rt, data.area, data.height, data.fwhm, data.sn,
        data.mz ?? null, data.mzLow ?? null, data.mzHigh ?? null,
        data.analyteId ?? null, data.analyteName ?? null,
        hasAnalyte ? userId : null,
        hasAnalyte ? "manual" : null,
        hasAnalyte ? 1 : null,
      ],
    );
    return { peak: mapPeak(row) };
  });

// ---- Delete run ----
async function deleteRunInternal(db: import("@/db/index.server").Db, userId: string, runId: string) {
  const run = await db.maybe<any>(
    "select id, uploaded_by, file_path, scans_blob_path from public.runs where id=$1",
    [runId]);
  if (!run) return { ok: true, missing: true };
  if (run.uploaded_by && run.uploaded_by !== userId)
    throw new Error("You don't have permission to delete this run.");
  const paths = [run.file_path, run.scans_blob_path].filter(
    (p): p is string => typeof p === "string" && p.length > 0);
  if (paths.length > 0) await removeObjects("raw-runs", paths);
  await db.query("delete from public.peaks where run_id=$1", [runId]);
  await db.query("delete from public.runs where id=$1", [runId]);
  return { ok: true };
}

export const deleteRun = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ runId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    return deleteRunInternal(db, userId, data.runId);
  });

export const deleteBatch = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((d) => z.object({ batchId: z.string(), deleteRuns: z.boolean().default(false) }).parse(d))
  .handler(async ({ data, context }) => {
    const { userId, db } = context as { userId: string; email: string; isAdmin: boolean; db: import("@/db/index.server").Db };
    const batch = await db.maybe<any>(
      "select id, owner_id from public.batches where id=$1", [data.batchId]);
    if (!batch) return { ok: true, missing: true };
    if (batch.owner_id && batch.owner_id !== userId)
      throw new Error("You don't have permission to delete this batch.");
    if (data.deleteRuns) {
      const runs = await db.many<any>(
        "select id from public.runs where batch_id=$1", [data.batchId]);
      for (const r of runs) await deleteRunInternal(db, userId, r.id);
    } else {
      await db.query(
        "update public.runs set batch_id=null where batch_id=$1", [data.batchId]);
    }
    await db.query("delete from public.batches where id=$1", [data.batchId]);
    return { ok: true };
  });
