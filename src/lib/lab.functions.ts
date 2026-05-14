import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const [data, currentUser] = await Promise.all([
      fetchAllForUser(supabase),
      getCurrentUserProfile(supabase, userId),
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
    .array(
      z.object({
        time: z.number().min(0).max(120),
        pctB: z.number().min(0).max(100),
        flow: z.number().min(0).max(5),
      }),
    )
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => MethodInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const row = {
      ...(data.id ? { id: data.id } : {}),
      name: data.name,
      modality: data.modality,
      column_id: data.columnId || null,
      gradient_json: data.gradient,
      ms_params_json: {
        mobilePhaseA: data.mobilePhaseA,
        mobilePhaseB: data.mobilePhaseB,
        flowRate: data.flowRate,
        columnTemp: data.columnTemp,
        injectionVolume: data.injectionVolume,
        detector: data.detector,
        msIonization: data.msIonization,
        msScanRange: data.msScanRange,
        tags: data.tags,
      },
      notes_md: data.notes,
      status: data.status,
      created_by: userId,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase
      .from("methods")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    return mapMethod(saved);
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
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ColumnInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const row = {
      ...(data.id ? { id: data.id } : {}),
      name: data.name,
      chemistry: data.chemistry,
      dimensions: data.dimensions,
      particle_size: data.particleSize,
      serial: data.serial,
      rated_injections: data.ratedInjections,
      used_injections: data.usedInjections,
      status: data.status,
      notes_md: data.notes,
      owner_id: userId,
      updated_at: new Date().toISOString(),
    };
    const { data: saved, error } = await supabase
      .from("columns")
      .upsert(row)
      .select()
      .single();
    if (error) throw error;
    return mapColumn(saved);
  });

// ---- Batches ----
const BatchInput = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(200),
  project: z.string().max(200).default(""),
});
export const upsertBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => BatchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: saved, error } = await supabase
      .from("batches")
      .upsert({
        ...(data.id ? { id: data.id } : {}),
        name: data.name,
        project: data.project,
        owner_id: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return mapBatch(saved, []);
  });

// ---- Analytes ----
const AnalyteInput = z.object({
  name: z.string().min(1).max(200),
  formula: z.string().max(100).default(""),
  mz: z.number().min(0).max(10000).optional().nullable(),
  rtExpected: z.number().min(0).max(120),
});
export const addAnalyte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AnalyteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    let mz = data.mz ?? null;
    if (mz == null || mz <= 0) {
      const computed = data.formula ? mzFromFormula(data.formula, "[M+H]+") : null;
      if (computed == null) {
        throw new Error("Provide a valid molecular formula or a manual m/z.");
      }
      mz = computed;
    }
    const { data: saved, error } = await supabase
      .from("analytes")
      .insert({
        name: data.name,
        formula: data.formula,
        mz,
        rt_expected: data.rtExpected,
        library_source: "user",
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return mapAnalyte(saved);
  });

const UpdateAnalyteInput = AnalyteInput.extend({ id: z.string() });
export const updateAnalyte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UpdateAnalyteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: existing, error: fErr } = await supabase
      .from("analytes")
      .select("id, created_by, library_source")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw fErr;
    if (!existing) throw new Error("Compound not found.");
    if (existing.library_source === "system" || existing.created_by !== userId) {
      throw new Error("You can only edit compounds you created.");
    }
    let mz = data.mz ?? null;
    if (mz == null || mz <= 0) {
      const computed = data.formula ? mzFromFormula(data.formula, "[M+H]+") : null;
      if (computed == null) {
        throw new Error("Provide a valid molecular formula or a manual m/z.");
      }
      mz = computed;
    }
    const { data: saved, error } = await supabase
      .from("analytes")
      .update({
        name: data.name,
        formula: data.formula,
        mz,
        rt_expected: data.rtExpected,
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw error;
    return mapAnalyte(saved);
  });

export const deleteAnalyte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: existing, error: fErr } = await supabase
      .from("analytes")
      .select("id, created_by, library_source")
      .eq("id", data.id)
      .maybeSingle();
    if (fErr) throw fErr;
    if (!existing) return { ok: true, missing: true };
    if (existing.library_source === "system" || existing.created_by !== userId) {
      throw new Error("You can only delete compounds you created.");
    }
    const { error } = await supabase.from("analytes").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---- Runs (file already uploaded to storage; persist summary + peaks) ----
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
    x: z.array(z.number()).max(20000),
    tic: z.array(z.number()).max(20000),
    bpc: z.array(z.number()).max(20000),
  }),
  peaks: z
    .array(
      z.object({
        rt: z.number(),
        area: z.number(),
        height: z.number(),
        fwhm: z.number(),
        sn: z.number(),
        mz: z.number().nullable().optional(),
        mzLow: z.number().nullable().optional(),
        mzHigh: z.number().nullable().optional(),
      }),
    )
    .max(2000),
});

export const createRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => RunInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: run, error } = await supabase
      .from("runs")
      .insert({
        method_id: data.methodId || null,
        column_id: data.columnId || null,
        batch_id: data.batchId || null,
        file_path: data.filePath,
        file_format: data.fileFormat,
        scans_blob_path: data.scansBlobPath || null,
        ms_level: data.msLevel,
        parsed_status: "parsed",
        summary_json: {
          name: data.name,
          fileSize: data.fileSize,
          ionMode: data.ionMode,
          trace: data.trace,
        },
        uploaded_by: userId,
      })
      .select()
      .single();
    if (error) throw error;

    let peaks: any[] = [];
    if (data.peaks.length > 0) {
      const { data: inserted, error: pe } = await supabase
        .from("peaks")
        .insert(
          data.peaks.map((p) => ({
            run_id: run.id,
            rt: p.rt,
            area: p.area,
            height: p.height,
            fwhm: p.fwhm,
            sn: p.sn,
            mz: p.mz ?? null,
            mz_low: p.mzLow ?? null,
            mz_high: p.mzHigh ?? null,
          })),
        )
        .select();
      if (pe) throw pe;
      peaks = inserted ?? [];
    }
    return mapRun(run, peaks.map(mapPeak));
  });

const AnnotateInput = z.object({
  runId: z.string(),
  peakId: z.string(),
  analyteId: z.string().optional().nullable(),
  label: z.string().max(200).optional(),
});
export const annotatePeak = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AnnotateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { error } = await supabase
      .from("peaks")
      .update({
        analyte_id: data.analyteId ?? null,
        annotated_by: userId,
        annotation_source: "manual",
        confidence: 1,
      })
      .eq("id", data.peakId);
    if (error) throw error;

    if (data.label) {
      await supabase.from("annotations").insert({
        run_id: data.runId,
        peak_id: data.peakId,
        label: data.label,
        author_id: userId,
      });
    }
    return { ok: true };
  });

// ---- EIC: extract on the server from the persisted scans blob ----
const EICInput = z.object({
  runId: z.string(),
  mz: z.number().min(0).max(10000),
  ppm: z.number().min(1).max(200).default(10),
});
export const getRunEIC = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => EICInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: run, error } = await supabase
      .from("runs")
      .select("scans_blob_path")
      .eq("id", data.runId)
      .single();
    if (error) throw error;
    if (!run?.scans_blob_path) {
      return { x: [] as number[], y: [] as number[], mz: data.mz, ppm: data.ppm, mzLow: 0, mzHigh: 0 };
    }
    const { data: blob, error: dlErr } = await supabase.storage
      .from("raw-runs")
      .download(run.scans_blob_path);
    if (dlErr) throw dlErr;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const { extractEICFromBlob } = await import("./eic");
    const trace = extractEICFromBlob(buf, data.mz, data.ppm);
    return trace;
  });

// ---- Batch EIC: extract many m/z from a single scans-blob download ----
const EICBatchInput = z.object({
  runId: z.string(),
  ppm: z.number().min(1).max(200).default(10),
  targets: z
    .array(z.object({ id: z.string().max(80), mz: z.number().min(0).max(10000) }))
    .min(1)
    .max(50),
});
export const getRunEICBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => EICBatchInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: run, error } = await supabase
      .from("runs")
      .select("scans_blob_path")
      .eq("id", data.runId)
      .single();
    if (error) throw error;
    if (!run?.scans_blob_path) {
      return { x: [] as number[], traces: [] as Array<any> };
    }
    const { data: blob, error: dlErr } = await supabase.storage
      .from("raw-runs")
      .download(run.scans_blob_path);
    if (dlErr) throw dlErr;
    const buf = new Uint8Array(await blob.arrayBuffer());
    const { unpackScans, extractEIC } = await import("./eic");
    const scans = unpackScans(buf);
    const x = scans.map((s) => s.rt);
    const traces = data.targets.map((t) => {
      const tr = extractEIC(scans, t.mz, data.ppm);
      const y = tr.y;
      const xs = tr.x;
      let peakIdx = -1;
      let peakInt = 0;
      for (let i = 0; i < y.length; i++) {
        if (y[i] > peakInt) {
          peakInt = y[i];
          peakIdx = i;
        }
      }
      // FWHM bounds
      let fwhm = 0;
      let area = 0;
      let sn = 0;
      if (peakIdx >= 0 && peakInt > 0) {
        const half = peakInt / 2;
        let l = peakIdx;
        while (l > 0 && y[l] > half) l--;
        let r = peakIdx;
        while (r < y.length - 1 && y[r] > half) r++;
        fwhm = Math.max(0, xs[r] - xs[l]);
        // Area bounds at 5% of apex (trapezoidal)
        const cut = peakInt * 0.05;
        let al = peakIdx;
        while (al > 0 && y[al] > cut) al--;
        let ar = peakIdx;
        while (ar < y.length - 1 && y[ar] > cut) ar++;
        for (let i = al; i < ar; i++) {
          area += ((y[i] + y[i + 1]) / 2) * (xs[i + 1] - xs[i]);
        }
        // S/N: apex / median of points outside the peak window
        const noise: number[] = [];
        for (let i = 0; i < y.length; i++) {
          if (i < al || i > ar) noise.push(y[i]);
        }
        let med = 0;
        if (noise.length > 0) {
          noise.sort((a, b) => a - b);
          med = noise[Math.floor(noise.length / 2)];
        }
        sn = peakInt / Math.max(1, med);
      }
      return {
        id: t.id,
        mz: t.mz,
        y,
        mzLow: tr.mzLow,
        mzHigh: tr.mzHigh,
        peakRt: peakIdx >= 0 ? xs[peakIdx] : null,
        peakIntensity: peakInt,
        area,
        height: peakInt,
        fwhm,
        sn,
      };
    });
    return { x, traces };
  });

// ---- Admin ----
export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    return await listAllUsersAdmin();
  });

const SetRoleInput = z.object({
  userId: z.string().uuid(),
  role: z.enum(["admin", "developer", "reviewer"]),
});
export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SetRoleInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    await setUserRoleAdmin(data.userId, data.role);
    return { ok: true };
  });

// ---- Storage signed-upload for raw / scans / report files ----
const UploadUrlInput = z.object({
  filename: z.string().min(1).max(300),
  bucket: z.enum(["raw-runs", "reports"]).default("raw-runs"),
  suffix: z.string().max(40).optional(),
});
export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UploadUrlInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const stamp = Date.now();
    const path = `${userId}/${stamp}-${safe}${data.suffix ?? ""}`;
    const { data: up, error } = await supabase.storage
      .from(data.bucket)
      .createSignedUploadUrl(path);
    if (error) throw error;
    return { path, token: up.token, signedUrl: up.signedUrl, bucket: data.bucket };
  });

// ---- Reports (record metadata; PDF rendered + uploaded client-side) ----
const ReportInput = z.object({
  title: z.string().min(1).max(200),
  template: z.enum(["run", "batch", "method"]),
  runIds: z.array(z.string().uuid()).max(50).default([]),
  batchId: z.string().uuid().optional().nullable(),
  storagePath: z.string().min(1).max(500),
});
export const createReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ReportInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: row, error } = await supabase
      .from("reports")
      .insert({
        title: data.title,
        template: data.template,
        run_ids: data.runIds,
        batch_id: data.batchId ?? null,
        storage_path: data.storagePath,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return row;
  });

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context as any;
    const { data, error } = await supabase
      .from("reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getReportSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { data: row, error } = await supabase
      .from("reports")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    if (error) throw error;
    const { data: signed, error: se } = await supabase.storage
      .from("reports")
      .createSignedUrl(row.storage_path, 60 * 10);
    if (se) throw se;
    return { url: signed.signedUrl };
  });

// ---- Sharing links ----
const ShareInput = z.object({
  resourceKind: z.enum(["run", "report"]),
  resourceId: z.string().uuid(),
  expiresInHours: z.number().int().min(1).max(24 * 365).default(168),
});
export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ShareInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const token = crypto.randomUUID().replace(/-/g, "");
    const expires = new Date(Date.now() + data.expiresInHours * 3_600_000).toISOString();
    const { data: row, error } = await supabase
      .from("shared_links")
      .insert({
        token,
        resource_kind: data.resourceKind,
        resource_id: data.resourceId,
        expires_at: expires,
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return { token: row.token, expiresAt: row.expires_at };
  });

// ---- Auto-annotate batch ----
const AutoAnnotateInput = z.object({
  batchId: z.string().uuid(),
  rtTolMin: z.number().min(0).max(5).default(0.3),
  ppmTol: z.number().min(0).max(200).default(10),
});
export const autoAnnotateBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AutoAnnotateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const [{ data: runs }, { data: analytes }] = await Promise.all([
      supabase.from("runs").select("id").eq("batch_id", data.batchId),
      supabase.from("analytes").select("id, name, mz, rt_expected"),
    ]);
    if (!runs?.length) return { annotated: 0, scanned: 0 };
    const runIds = runs.map((r: any) => r.id);
    const { data: peaks } = await supabase
      .from("peaks")
      .select("id, rt, mz, run_id")
      .in("run_id", runIds);

    let annotated = 0;
    for (const p of peaks ?? []) {
      let bestScore = Infinity;
      let bestA: any = null;
      for (const a of analytes ?? []) {
        const dRt = Math.abs(p.rt - Number(a.rt_expected));
        if (dRt > data.rtTolMin) continue;
        const dPpm = p.mz != null ? Math.abs((Number(p.mz) - Number(a.mz)) / Number(a.mz)) * 1e6 : 999;
        if (dPpm > data.ppmTol) continue;
        const score = dRt * 10 + dPpm;
        if (score < bestScore) {
          bestScore = score;
          bestA = a;
        }
      }
      if (bestA) {
        await supabase
          .from("peaks")
          .update({
            analyte_id: bestA.id,
            annotated_by: userId,
            annotation_source: "auto",
            confidence: Math.max(0.5, 1 - bestScore / 50),
          })
          .eq("id", p.id);
        annotated++;
      }
    }
    return { annotated, scanned: peaks?.length ?? 0 };
  });

// ---- Delete a run (and its storage objects + child rows) ----
async function deleteRunInternal(supabase: any, userId: string, runId: string) {
  const { data: run, error: fetchErr } = await supabase
    .from("runs")
    .select("id, uploaded_by, file_path, scans_blob_path")
    .eq("id", runId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!run) return { ok: true, missing: true };
  if (run.uploaded_by && run.uploaded_by !== userId) {
    throw new Error("You don't have permission to delete this run.");
  }

  const paths = [run.file_path, run.scans_blob_path].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (paths.length > 0) {
    // Best-effort: ignore missing-file errors so deletion still proceeds.
    await supabase.storage.from("raw-runs").remove(paths).catch(() => undefined);
  }

  // Remove children explicitly in case FKs aren't cascading.
  await supabase.from("peaks").delete().eq("run_id", runId);
  const { error: delErr } = await supabase.from("runs").delete().eq("id", runId);
  if (delErr) throw delErr;
  return { ok: true };
}

export const deleteRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ runId: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    return deleteRunInternal(supabase, userId, data.runId);
  });

export const deleteBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ batchId: z.string(), deleteRuns: z.boolean().default(false) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: batch, error: bErr } = await supabase
      .from("batches")
      .select("id, owner_id")
      .eq("id", data.batchId)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!batch) return { ok: true, missing: true };
    if (batch.owner_id && batch.owner_id !== userId) {
      throw new Error("You don't have permission to delete this batch.");
    }

    if (data.deleteRuns) {
      const { data: runs } = await supabase
        .from("runs")
        .select("id")
        .eq("batch_id", data.batchId);
      for (const r of runs ?? []) {
        await deleteRunInternal(supabase, userId, r.id);
      }
    } else {
      await supabase
        .from("runs")
        .update({ batch_id: null })
        .eq("batch_id", data.batchId);
    }

    const { error: delErr } = await supabase
      .from("batches")
      .delete()
      .eq("id", data.batchId);
    if (delErr) throw delErr;
    return { ok: true };
  });

