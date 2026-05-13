import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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
  mz: z.number().min(0).max(10000),
  rtExpected: z.number().min(0).max(120),
});
export const addAnalyte = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => AnalyteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: saved, error } = await supabase
      .from("analytes")
      .insert({
        name: data.name,
        formula: data.formula,
        mz: data.mz,
        rt_expected: data.rtExpected,
        library_source: "user",
        created_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    return mapAnalyte(saved);
  });

// ---- Runs (file already uploaded to storage; persist summary + peaks) ----
const RunInput = z.object({
  name: z.string().min(1).max(300),
  methodId: z.string().optional().nullable(),
  columnId: z.string().optional().nullable(),
  batchId: z.string().optional().nullable(),
  filePath: z.string().max(500),
  fileFormat: z.enum(["mzML", "mzXML", "raw"]).default("mzML"),
  fileSize: z.string().max(40),
  ionMode: z.enum(["positive", "negative"]).default("positive"),
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
        mz: z.number().optional(),
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

// ---- Storage signed-upload for raw files ----
const UploadUrlInput = z.object({
  filename: z.string().min(1).max(300),
});
export const createUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => UploadUrlInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${userId}/${Date.now()}-${safe}`;
    const { data: up, error } = await supabase.storage
      .from("raw-runs")
      .createSignedUploadUrl(path);
    if (error) throw error;
    return { path, token: up.token, signedUrl: up.signedUrl };
  });
