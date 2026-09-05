// Server-only helpers: DB row mappers + queries (pg-based, no Supabase).
import type { Db } from "@/db/index.server";
import { withAdmin } from "@/db/index.server";
import { createSignedDownloadUrl } from "@/lib/storage.server";
import type {
  Method, Run, Column, Batch, Analyte, Peak, User,
  ColumnInjection, CompoundList, MethodColumnListDefault,
  RtAlignment, ISAssignment, SampleQueue, SampleQueueEntry,
  MethodTemplate, ReportJob, CustomColumn, ImportWatchFolder,
  ImportedFile, NceOptimization,
  BufferExchangeEvent, QcRun, AnomalyCheck,
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
  const msScans = Array.isArray(r.ms_scans_json) ? r.ms_scans_json : [];
  const msGlobal = ms.msGlobalSettings ?? null;
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
    msGlobalSettings: msGlobal,
    msScans,
    methodFilePath: r.method_file_path ?? null,
    methodFileName: r.method_file_name ?? null,
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
    r2: r.r2 != null ? Number(r.r2) : undefined,
    asymmetry: r.asymmetry != null ? Number(r.asymmetry) : undefined,
    notes: r.notes ?? "",
    alignedRt: r.aligned_rt != null ? Number(r.aligned_rt) : undefined,
    isNormalizedArea: r.is_normalized_area != null ? Number(r.is_normalized_area) : undefined,
    customValues: r.custom_values ?? undefined,
    adductType: r.adduct_type ?? undefined,
    deconvolved: r.deconvolved === true,
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
    injectionId: r.injection_id ?? null,
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
    notes: r.notes ?? "",
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
    status: (r.status as Batch["status"]) ?? "in_progress",
    owner: r.owner_id ?? "",
    notes: r.notes ?? "",
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

export function mapInjection(r: any): ColumnInjection {
  return {
    id: r.id,
    columnId: r.column_id,
    runId: r.run_id ?? null,
    methodId: r.method_id ?? null,
    sequenceName: r.sequence_name ?? "",
    injectionNum: Number(r.injection_num ?? 0),
    startingPressure: r.starting_pressure != null ? Number(r.starting_pressure) : null,
    notes: r.notes ?? "",
    performedBy: r.performed_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapCompoundList(r: any, analyteIds: string[] = []): CompoundList {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    analyteIds,
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export function mapListDefault(r: any): MethodColumnListDefault {
  return {
    id: r.id,
    methodId: r.method_id,
    columnId: r.column_id,
    listId: r.list_id,
  };
}

// ---- V3 Mappers ----
export function mapRtAlignment(r: any): RtAlignment {
  return {
    id: r.id,
    batchId: r.batch_id ?? null,
    referenceRunId: r.reference_run_id ?? null,
    alignmentMethod: (r.alignment_method as RtAlignment["alignmentMethod"]) ?? "landmark",
    shiftJson: r.shift_json ?? {},
    createdAt: String(r.created_at),
  };
}

export function mapISAssignment(r: any): ISAssignment {
  return {
    id: r.id,
    analyteId: r.analyte_id,
    isAnalyteId: r.is_analyte_id,
    methodId: r.method_id ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapSampleQueue(r: any, entries: SampleQueueEntry[] = []): SampleQueue & { entries: SampleQueueEntry[] } {
  return {
    id: r.id,
    name: r.name,
    batchId: r.batch_id ?? null,
    instrument: r.instrument ?? "",
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
    entries,
  };
}

export function mapSampleQueueEntry(r: any): SampleQueueEntry {
  return {
    id: r.id,
    queueId: r.queue_id,
    position: Number(r.position ?? 0),
    sampleName: r.sample_name ?? "",
    sampleType: (r.sample_type as SampleQueueEntry["sampleType"]) ?? "unknown",
    vialPosition: r.vial_position ?? "",
    trayCode: r.tray_code ?? "",
    methodPath: r.method_path ?? "",
    methodId: r.method_id ?? null,
    columnId: r.column_id ?? null,
    injectionVolume: Number(r.injection_volume ?? 0),
    dilutionFactor: Number(r.dilution_factor ?? 1),
    status: (r.status as SampleQueueEntry["status"]) ?? "pending",
    runId: r.run_id ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapMethodTemplate(r: any): MethodTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? "",
    templateJson: r.template_json ?? {},
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapReportJob(r: any): ReportJob {
  return {
    id: r.id,
    title: r.title,
    template: r.template ?? "standard",
    runIds: r.run_ids ?? [],
    batchId: r.batch_id ?? null,
    includeSections: r.include_sections ?? [],
    outputFormat: (r.output_format as ReportJob["outputFormat"]) ?? "pdf",
    storagePath: r.storage_path ?? null,
    emailTo: r.email_to ?? [],
    emailSentAt: r.email_sent_at ?? null,
    status: (r.status as ReportJob["status"]) ?? "pending",
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapCustomColumn(r: any): CustomColumn {
  return {
    id: r.id,
    methodId: r.method_id ?? null,
    name: r.name,
    formula: r.formula,
    unit: r.unit ?? "",
    displayOrder: Number(r.display_order ?? 0),
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapImportWatchFolder(r: any): ImportWatchFolder {
  return {
    id: r.id,
    path: r.path,
    enabled: r.enabled !== false,
    methodId: r.method_id ?? null,
    columnId: r.column_id ?? null,
    batchId: r.batch_id ?? null,
    filePattern: r.file_pattern ?? "*.mzXML",
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapImportedFile(r: any): ImportedFile {
  return {
    id: r.id,
    folderId: r.folder_id,
    filePath: r.file_path,
    fileName: r.file_name,
    status: (r.status as ImportedFile["status"]) ?? "pending",
    runId: r.run_id ?? null,
    errorMessage: r.error_message ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapNceOptimization(r: any): NceOptimization {
  return {
    id: r.id,
    analyteId: r.analyte_id,
    methodId: r.method_id ?? null,
    nceTested: r.nce_tested != null ? Number(r.nce_tested) : null,
    bestNce: r.best_nce != null ? Number(r.best_nce) : null,
    bestFragmentCount: r.best_fragment_count ?? null,
    spectraJson: r.spectra_json ?? [],
    notes: r.notes ?? "",
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapBufferExchangeEvent(r: any): BufferExchangeEvent {
  return {
    id: r.id,
    columnId: r.column_id,
    batchId: r.batch_id ?? null,
    kind: r.kind,
    oldDescription: r.old_description ?? "",
    newDescription: r.new_description ?? "",
    oldLot: r.old_lot ?? "",
    newLot: r.new_lot ?? "",
    reason: r.reason ?? "",
    performedBy: r.performed_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapQcRun(r: any): QcRun {
  return {
    id: r.id,
    columnId: r.column_id,
    batchId: r.batch_id ?? null,
    methodId: r.method_id ?? null,
    runId: r.run_id ?? null,
    name: r.name,
    qcType: r.qc_type ?? "system_suitability",
    filePath: r.file_path ?? null,
    fileName: r.file_name ?? null,
    acquiredAt: String(r.acquired_at),
    uploadedBy: r.uploaded_by ?? null,
    createdAt: String(r.created_at),
  };
}

export function mapAnomalyCheck(r: any): AnomalyCheck {
  return {
    id: r.id,
    scope: r.scope,
    scopeId: r.scope_id ?? null,
    batchId: r.batch_id ?? null,
    columnId: r.column_id ?? null,
    checkType: r.check_type,
    severity: r.severity ?? "info",
    message: r.message,
    metricsJson: r.metrics_json ?? {},
    resolved: r.resolved ?? false,
    resolvedBy: r.resolved_by ?? null,
    resolvedAt: r.resolved_at ? String(r.resolved_at) : null,
    createdBy: r.created_by ?? null,
    createdAt: String(r.created_at),
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
  // Run queries sequentially — pg doesn't support concurrent queries on a
  // single client, which causes "client is already executing a query" errors.
  const columns = await db.many("select * from public.columns order by created_at desc");
  const methods = await db.many("select * from public.methods order by updated_at desc");
  const runs = await db.many("select * from public.runs order by acquired_at desc");
  const peaks = await db.many("select * from public.peaks");
  const batches = await db.many("select * from public.batches order by started_at desc");
  const analytes = await db.many("select * from public.analytes order by name");
  const injections = await db.many("select * from public.column_injections order by injection_num");
  const compoundListsRaw = await db.many("select * from public.compound_lists order by name");
  const listEntries = await db.many("select * from public.compound_list_entries");
  const listDefaults = await db.many("select * from public.method_column_list_defaults");

  // V3 tables — wrapped in try/catch so missing tables don't break the app
  // during the transition (schema migration runs on next container start).
  let isAssignments: any[] = [];
  let sampleQueues: any[] = [];
  let sampleQueueEntries: any[] = [];
  let methodTemplates: any[] = [];
  let reportJobs: any[] = [];
  let customColumns: any[] = [];
  let importWatchFolders: any[] = [];
  let nceOptimizations: any[] = [];
  let bufferExchangeEvents: any[] = [];
  let qcRuns: any[] = [];
  let anomalyChecks: any[] = [];
  try { isAssignments = await db.many("select * from public.is_assignments"); } catch { /* table may not exist yet */ }
  try { sampleQueues = await db.many("select * from public.sample_queues order by created_at desc"); } catch {}
  try { sampleQueueEntries = await db.many("select * from public.sample_queue_entries order by position"); } catch {}
  try { methodTemplates = await db.many("select * from public.method_templates order by name"); } catch {}
  try { reportJobs = await db.many("select * from public.report_jobs order by created_at desc"); } catch {}
  try { customColumns = await db.many("select * from public.custom_columns order by display_order"); } catch {}
  try { importWatchFolders = await db.many("select * from public.import_watch_folders"); } catch {}
  try { nceOptimizations = await db.many("select * from public.nce_optimization"); } catch {}
  try { bufferExchangeEvents = await db.many("select * from public.buffer_exchange_events order by created_at desc"); } catch {}
  try { qcRuns = await db.many("select * from public.qc_runs order by acquired_at desc"); } catch {}
  try { anomalyChecks = await db.many("select * from public.anomaly_checks order by created_at desc"); } catch {}

  // Fetch per-column RT overrides for all analytes.
  const columnRts = await db.many<any>(
    `select acrt.id, acrt.analyte_id, acrt.column_id, acrt.rt_expected,
            acrt.notes, acrt.updated_at, c.name as column_name
     from public.analyte_column_rt acrt
     join public.columns c on c.id = acrt.column_id
     order by c.name`,
  );
  const columnRtByAnalyte = new Map<string, any[]>();
  for (const cr of columnRts) {
    const arr = columnRtByAnalyte.get(cr.analyte_id) ?? [];
    arr.push({
      id: cr.id,
      analyteId: cr.analyte_id,
      columnId: cr.column_id,
      columnName: cr.column_name,
      rtExpected: Number(cr.rt_expected),
      notes: cr.notes ?? "",
      updatedAt: cr.updated_at,
    });
    columnRtByAnalyte.set(cr.analyte_id, arr);
  }

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

  // Group compound list entries by list_id
  const entriesByList = new Map<string, string[]>();
  for (const e of listEntries) {
    const arr = entriesByList.get(e.list_id) ?? [];
    arr.push(e.analyte_id);
    entriesByList.set(e.list_id, arr);
  }

  // Group sample queue entries by queue_id
  const entriesByQueue = new Map<string, any[]>();
  for (const e of sampleQueueEntries) {
    const arr = entriesByQueue.get(e.queue_id) ?? [];
    arr.push(mapSampleQueueEntry(e));
    entriesByQueue.set(e.queue_id, arr);
  }

  return {
    columns: columns.map(mapColumn),
    methods: methods.map(mapMethod),
    runs: runsMapped,
    batches: batches.map((b: any) => mapBatch(b, runsByBatch.get(b.id) ?? [])),
    analytes: analytes.map((a: any) => ({
      ...mapAnalyte(a),
      columnRts: columnRtByAnalyte.get(a.id) ?? [],
    })),
    injections: injections.map(mapInjection),
    compoundLists: compoundListsRaw.map((cl: any) =>
      mapCompoundList(cl, entriesByList.get(cl.id) ?? []),
    ),
    listDefaults: listDefaults.map(mapListDefault),
    // V3 data
    isAssignments: isAssignments.map(mapISAssignment),
    sampleQueues: sampleQueues.map((sq: any) =>
      mapSampleQueue(sq, entriesByQueue.get(sq.id) ?? []),
    ),
    methodTemplates: methodTemplates.map(mapMethodTemplate),
    reportJobs: reportJobs.map(mapReportJob),
    customColumns: customColumns.map(mapCustomColumn),
    importWatchFolders: importWatchFolders.map(mapImportWatchFolder),
    nceOptimizations: nceOptimizations.map(mapNceOptimization),
    bufferExchangeEvents: bufferExchangeEvents.map(mapBufferExchangeEvent),
    qcRuns: qcRuns.map(mapQcRun),
    anomalyChecks: anomalyChecks.map(mapAnomalyCheck),
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
    roles.find((r) => r.role === "admin")?.role ?? roles[0]?.role ?? "user";
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
    return Promise.all(rows.map((r) => {
      const rolesArr = (r.roles ?? "").split(",").filter(Boolean);
      const role = rolesArr.includes("admin") ? "admin" : rolesArr[0] ?? "user";
      return mapUser(
        { id: r.id, email: r.email, display_name: r.display_name, avatar_url: r.avatar_url },
        role,
      );
    }));
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
