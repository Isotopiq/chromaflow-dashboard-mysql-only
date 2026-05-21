// Server-only helpers: DB row mappers + queries.
// Lives in a *.server.ts file so it never leaks into the client bundle.
import { supabaseAdmin, createUserClient } from "@/integrations/supabase/client.server";
import type {
  Method,
  Run,
  Column,
  Batch,
  Analyte,
  Peak,
  User,
} from "@/lib/lab-types";

export type SupabaseUserClient = ReturnType<typeof createUserClient>;

// ---------- Mappers ----------
export function mapColumn(r: any): Column {
  return {
    id: r.id,
    name: r.name,
    chemistry: r.chemistry ?? "",
    dimensions: r.dimensions ?? "",
    particleSize: r.particle_size ?? "",
    serial: r.serial ?? "",
    ratedInjections: r.rated_injections ?? 1000,
    injectionsUsed: r.used_injections ?? 0,
    installedAt: r.installed_at,
    status: (r.status as Column["status"]) ?? "healthy",
    pressureTrend: Array.isArray(r.pressure_trend) ? r.pressure_trend : [],
    notes: r.notes_md ?? "",
    manufacturer: r.manufacturer ?? "",
  };
}

export function mapMethod(r: any): Method {
  const ms = r.ms_params_json ?? {};
  return {
    id: r.id,
    name: r.name,
    modality: (r.modality as Method["modality"]) ?? "RP-LC-MS",
    columnId: r.column_id ?? "",
    status: (r.status as Method["status"]) ?? "draft",
    mobilePhaseA: ms.mobilePhaseA ?? "",
    mobilePhaseB: ms.mobilePhaseB ?? "",
    gradient: Array.isArray(r.gradient_json) ? r.gradient_json : [],
    flowRate: ms.flowRate ?? 0.3,
    columnTemp: ms.columnTemp ?? 30,
    injectionVolume: ms.injectionVolume ?? 2,
    detector: ms.detector ?? "",
    msIonization: (ms.msIonization as Method["msIonization"]) ?? "ESI+",
    msScanRange: ms.msScanRange ?? [100, 1200],
    notes: r.notes_md ?? "",
    createdBy: r.created_by ?? "",
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    tags: ms.tags ?? [],
    runIds: ms.runIds ?? [],
  };
}

export function mapPeak(r: any): Peak {
  return {
    id: r.id,
    rt: Number(r.rt),
    area: Number(r.area ?? 0),
    height: Number(r.height ?? 0),
    fwhm: Number(r.fwhm ?? 0),
    sn: Number(r.sn ?? 0),
    mz: r.mz != null ? Number(r.mz) : undefined,
    mzLow: r.mz_low != null ? Number(r.mz_low) : undefined,
    mzHigh: r.mz_high != null ? Number(r.mz_high) : undefined,
    analyteId: r.analyte_id ?? undefined,
    analyteName: r.analyte_name ?? undefined,
    confidence: r.confidence != null ? Number(r.confidence) : undefined,
    manual: r.manual === true,
  };
}

export function mapRun(r: any, peaks: Peak[] = []): Run {
  const s = r.summary_json ?? {};
  return {
    id: r.id,
    name: s.name ?? r.file_path?.split("/").pop() ?? "run",
    methodId: r.method_id ?? "",
    columnId: r.column_id ?? "",
    batchId: r.batch_id ?? undefined,
    acquiredAt: r.acquired_at,
    fileFormat: (r.file_format as Run["fileFormat"]) ?? "mzML",
    fileSize: s.fileSize ?? "—",
    parsedStatus: (r.parsed_status as Run["parsedStatus"]) ?? "parsed",
    uploadedBy: r.uploaded_by ?? "",
    trace: s.trace ?? { x: [], tic: [], bpc: [] },
    peaks,
    ionMode: (s.ionMode as Run["ionMode"]) ?? "positive",
    scansBlobPath: r.scans_blob_path ?? null,
    msLevel: r.ms_level ?? 1,
  };
}

export function mapBatch(r: any, runIds: string[] = []): Batch {
  return {
    id: r.id,
    name: r.name,
    project: r.project ?? "",
    startedAt: r.started_at,
    sampleCount: runIds.length,
    runIds,
    status: "in_progress",
    owner: r.owner_id ?? "",
  };
}

export function mapAnalyte(r: any): Analyte {
  return {
    id: r.id,
    name: r.name,
    formula: r.formula ?? "",
    mz: Number(r.mz ?? 0),
    rtExpected: Number(r.rt_expected ?? 0),
    class: r.library_source ?? "library",
    createdBy: r.created_by ?? null,
    librarySource: r.library_source ?? null,
  };
}

export function mapUser(profile: any, role: string): User {
  const name = profile.display_name ?? "user";
  const avatarPath = profile.avatar_url ?? null;
  const avatarUrl = avatarPath
    ? supabaseAdmin.storage.from("avatars").getPublicUrl(avatarPath).data.publicUrl ?? null
    : null;
  return {
    id: profile.id,
    name,
    email: profile.email ?? "",
    role: (role as User["role"]) ?? "developer",
    avatar: name
      .split(" ")
      .map((p: string) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
    avatarUrl,
  };
}

// ---------- Bulk fetchers ----------
export async function fetchAllForUser(supabase: SupabaseUserClient) {
  const [columns, methods, runs, peaks, batches, analytes] = await Promise.all([
    supabase.from("columns").select("*").order("created_at", { ascending: false }),
    supabase.from("methods").select("*").order("updated_at", { ascending: false }),
    supabase.from("runs").select("*").order("acquired_at", { ascending: false }),
    supabase.from("peaks").select("*"),
    supabase.from("batches").select("*").order("started_at", { ascending: false }),
    supabase.from("analytes").select("*").order("name"),
  ]);

  if (columns.error) throw columns.error;
  if (methods.error) throw methods.error;
  if (runs.error) throw runs.error;
  if (peaks.error) throw peaks.error;
  if (batches.error) throw batches.error;
  if (analytes.error) throw analytes.error;

  const peakRows = peaks.data ?? [];
  const peaksByRun = new Map<string, Peak[]>();
  for (const p of peakRows) {
    const key = p.run_id;
    if (!peaksByRun.has(key)) peaksByRun.set(key, []);
    peaksByRun.get(key)!.push(mapPeak(p));
  }

  const runRows = runs.data ?? [];
  const runsMapped = runRows.map((r: any) =>
    mapRun(r, (peaksByRun.get(r.id) ?? []).sort((a, b) => a.rt - b.rt)),
  );

  const runsByBatch = new Map<string, string[]>();
  for (const r of runRows) {
    if (!r.batch_id) continue;
    if (!runsByBatch.has(r.batch_id)) runsByBatch.set(r.batch_id, []);
    runsByBatch.get(r.batch_id)!.push(r.id);
  }

  return {
    columns: (columns.data ?? []).map(mapColumn),
    methods: (methods.data ?? []).map(mapMethod),
    runs: runsMapped,
    batches: (batches.data ?? []).map((b: any) => mapBatch(b, runsByBatch.get(b.id) ?? [])),
    analytes: (analytes.data ?? []).map(mapAnalyte),
  };
}

export async function getCurrentUserProfile(
  supabase: SupabaseUserClient,
  userId: string,
) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw error;

  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);

  const role =
    roles?.find((r: any) => r.role === "admin")?.role ??
    roles?.[0]?.role ??
    "developer";

  return mapUser({ ...profile, email: undefined }, role);
}

// ---------- Admin (service role) ----------
export async function listAllUsersAdmin(): Promise<User[]> {
  const [{ data: profiles }, { data: roles }, { data: authUsers }] = await Promise.all([
    supabaseAdmin.from("profiles").select("*"),
    supabaseAdmin.from("user_roles").select("user_id, role"),
    supabaseAdmin.auth.admin.listUsers(),
  ]);

  const emailById = new Map<string, string>();
  for (const u of authUsers?.users ?? []) {
    if (u.id && u.email) emailById.set(u.id, u.email);
  }
  const roleById = new Map<string, string>();
  for (const r of roles ?? []) {
    // prefer admin if user has multiple
    const existing = roleById.get(r.user_id);
    if (existing === "admin") continue;
    roleById.set(r.user_id, r.role);
  }
  return (profiles ?? []).map((p: any) =>
    mapUser({ ...p, email: emailById.get(p.id) ?? "" }, roleById.get(p.id) ?? "developer"),
  );
}

export async function setUserRoleAdmin(userId: string, role: User["role"]) {
  // Replace roles for this user
  await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
  const { error } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: userId, role });
  if (error) throw error;
}
