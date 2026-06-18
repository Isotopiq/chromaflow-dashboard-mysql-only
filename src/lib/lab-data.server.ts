// Server-only helpers: DB row mappers + queries (pg-based, no Supabase).
import type { Db } from "@/db/index.server";
import { withAdmin } from "@/db/index.server";
import { createSignedDownloadUrl } from "@/lib/storage.server";
import type {
  Method, Run, Column, Batch, Analyte, Peak, User,
} from "@/lib/lab-types";

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

export async function mapUser(profile: any, role: string): Promise<User> {
  const name = profile.display_name ?? "user";
  const avatarPath = profile.avatar_url ?? null;
  let avatarUrl: string | null = null;
  if (avatarPath) {
    try {
      avatarUrl = await createSignedDownloadUrl("avatars", avatarPath, 60 * 60);
    } catch {
      avatarUrl = null;
    }
  }
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
export async function fetchAllForUser(db: Db) {
  const [columns, methods, runs, peaks, batches, analytes] = await Promise.all([
    db.many("select * from public.columns order by created_at desc"),
    db.many("select * from public.methods order by updated_at desc"),
    db.many("select * from public.runs order by acquired_at desc"),
    db.many("select * from public.peaks"),
    db.many("select * from public.batches order by started_at desc"),
    db.many("select * from public.analytes order by name"),
  ]);

  const peaksByRun = new Map<string, Peak[]>();
  for (const p of peaks) {
    const key = p.run_id;
    if (!peaksByRun.has(key)) peaksByRun.set(key, []);
    peaksByRun.get(key)!.push(mapPeak(p));
  }

  const runsMapped = runs.map((r: any) =>
    mapRun(r, (peaksByRun.get(r.id) ?? []).sort((a, b) => a.rt - b.rt)),
  );

  const runsByBatch = new Map<string, string[]>();
  for (const r of runs) {
    if (!r.batch_id) continue;
    if (!runsByBatch.has(r.batch_id)) runsByBatch.set(r.batch_id, []);
    runsByBatch.get(r.batch_id)!.push(r.id);
  }

  return {
    columns: columns.map(mapColumn),
    methods: methods.map(mapMethod),
    runs: runsMapped,
    batches: batches.map((b: any) => mapBatch(b, runsByBatch.get(b.id) ?? [])),
    analytes: analytes.map(mapAnalyte),
  };
}

export async function getCurrentUserProfile(db: Db, userId: string, email: string) {
  const profile = await db.maybe<any>(
    "select id, display_name, avatar_url from public.profiles where id = $1",
    [userId],
  );
  // Ensure a profile row exists.
  if (!profile) {
    await db.query("select public.ensure_profile($1, $2)", [userId, email.split("@")[0]]);
  }
  const roles = await db.many<{ role: string }>(
    "select role from public.user_roles where user_id = $1",
    [userId],
  );
  const role =
    roles.find((r) => r.role === "admin")?.role ?? roles[0]?.role ?? "developer";
  return mapUser({ ...(profile ?? { id: userId }), email }, role);
}

// ---------- Admin ----------
export async function listAllUsersAdmin(): Promise<User[]> {
  return withAdmin(async (db) => {
    const rows = await db.many<any>(`
      select u.id, u.email, p.display_name, p.avatar_url,
             coalesce((
               select string_agg(role::text, ',') from public.user_roles where user_id = u.id
             ), '') as roles
        from public.app_users u
        left join public.profiles p on p.id = u.id
        order by u.created_at desc
    `);
    return rows.map((r) => {
      const rolesArr = (r.roles ?? "").split(",").filter(Boolean);
      const role = rolesArr.includes("admin") ? "admin" : rolesArr[0] ?? "developer";
      return mapUser(
        { id: r.id, email: r.email, display_name: r.display_name, avatar_url: r.avatar_url },
        role,
      );
    });
  });
}

export async function setUserRoleAdmin(userId: string, role: User["role"]) {
  await withAdmin(async (db) => {
    await db.query("delete from public.user_roles where user_id = $1", [userId]);
    await db.query(
      "insert into public.user_roles (user_id, role) values ($1, $2)",
      [userId, role],
    );
  });
}
