export type Peak = {
  id: string;
  rt: number;
  area: number;
  height: number;
  fwhm: number;
  sn: number;
  mz?: number;
  mzLow?: number;
  mzHigh?: number;
  analyteId?: string;
  analyteName?: string;
  confidence?: number;
  manual?: boolean;
  /** Gaussian-fit R² of the peak shape (0–1). Higher = more peak-like. */
  r2?: number;
  /** Asymmetry factor at 10% height (1.0 = symmetric, >1 = tailing). */
  asymmetry?: number;
  /** Free-text reviewer notes saved server-side. */
  notes?: string;
  /** RT after alignment correction (V3). */
  alignedRt?: number;
  /** Area normalized by internal standard (V3). */
  isNormalizedArea?: number;
  /** Custom formula column values (V3). */
  customValues?: Record<string, number>;
  /** Detected adduct type, e.g. "[M+Na]+" (V3). */
  adductType?: string;
  /** Whether this peak was resolved by deconvolution (V3). */
  deconvolved?: boolean;
};

export type Run = {
  id: string;
  name: string;
  methodId: string;
  columnId: string;
  batchId?: string;
  injectionId?: string | null;
  acquiredAt: string;
  fileFormat: "mzML" | "mzXML" | "raw";
  fileSize: string;
  parsedStatus: "parsed" | "parsing" | "failed";
  uploadedBy: string;
  trace: { x: number[]; tic: number[]; bpc: number[] };
  peaks: Peak[];
  ionMode: "positive" | "negative";
  scansBlobPath?: string | null;
  msLevel?: number;
  notes?: string;
};

export type GradientStep = { time: number; pctB: number; flow: number };

export type MsScan = {
  scanType: "MS1" | "ddMS2" | "tSIM" | "tMS2" | "PRM" | "AllIons";
  experimentName: string;
  startTimeMin: number | null;
  endTimeMin: number | null;
  orbitrapResolution: number | null;
  scanRangeMz: [number, number] | null;
  agcTarget: string | null;
  microscans: number | null;
  rfLensPct: number | null;
  maxInjectionTimeMode: string | null;
  maxInjectionTimeMs: number | null;
  dataType: string | null;
  polarity: string | null;
  sourceFragmentation: boolean | null;
  lockMassInjection: boolean | null;
  scanDescription: string | null;
  isolationOffset: string | null;
  isolationWindow: string | null;
  isolationWindowMz: number | null;
  multiplexIonsEnabled: boolean | null;
  maxMultiplexedIons: number | null;
  reportedMass: string | null;
  turboTmt: string | null;
  scanRangeMode: string | null;
  intensityThreshold: number | null;
  dynamicExclusionMode: string | null;
  isotopeExclusion: string | null;
  precursorSelectionRange: [number, number] | null;
  extraParams: { key: string; value: string }[];
};

export type MsGlobalSettings = {
  useIonSourceFromTune: boolean | null;
  methodDurationMin: number | null;
  sprayVoltage: string | null;
  gasMode: string | null;
  infusionMode: string | null;
  carrierGasFlowType: string | null;
  faimsMode: string | null;
  lockMassCorrection: string | null;
  mode: string | null;
  applicationMode: string | null;
  pressureMode: string | null;
  expectedPeakWidthS: number | null;
  defaultChargeState: number | null;
  advancedPeakDetermination: boolean | null;
  mildTrapping: boolean | null;
};

export type Method = {
  id: string;
  name: string;
  modality: "RP-LC-MS" | "HILIC-MS" | "IEX" | "SEC";
  columnId: string;
  status: "draft" | "validated" | "archived";
  mobilePhaseA: string;
  mobilePhaseB: string;
  gradient: GradientStep[];
  flowRate: number;
  columnTemp: number;
  injectionVolume: number;
  detector: string;
  msIonization: "ESI+" | "ESI-" | "ESI±" | "APCI+" | "APCI-";
  msScanRange: [number, number];
  msGlobalSettings: MsGlobalSettings | null;
  msScans: MsScan[];
  methodFilePath: string | null;
  methodFileName: string | null;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  runIds: string[];
};

export type Column = {
  id: string;
  name: string;
  chemistry: string;
  dimensions: string;
  particleSize: string;
  serial: string;
  ratedInjections: number;
  injectionsUsed: number;
  installedAt: string;
  status: "healthy" | "warn" | "expired";
  pressureTrend: number[];
  notes: string;
  manufacturer: string;
};

export type AnalyteColumnRt = {
  id: string;
  analyteId: string;
  columnId: string;
  columnName: string;
  rtExpected: number;
  notes: string;
  updatedAt: string;
};

export type Analyte = {
  id: string;
  name: string;
  formula: string;
  mz: number;
  rtExpected: number;
  class: string;
  createdBy?: string | null;
  librarySource?: string | null;
  columnRts?: AnalyteColumnRt[];
};

export type Batch = {
  id: string;
  name: string;
  project: string;
  startedAt: string;
  sampleCount: number;
  runIds: string[];
  status: "in_progress" | "complete" | "review";
  owner: string;
  notes?: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "developer" | "reviewer" | "user";
  avatar: string;
  avatarUrl?: string | null;
};
export type ColumnServiceEvent = {
  id: string;
  columnId: string;
  kind: "reset" | "guard_change" | "maintenance" | "install";
  injectionsBefore: number;
  injectionsAfter: number;
  resetUsage: boolean;
  serial: string;
  notes: string;
  performedBy?: string | null;
  createdAt: string;
};

export type ColumnInjection = {
  id: string;
  columnId: string;
  runId?: string | null;
  methodId?: string | null;
  sequenceName: string;
  injectionNum: number;
  startingPressure?: number | null;
  notes: string;
  performedBy?: string | null;
  createdAt: string;
};

export type CompoundList = {
  id: string;
  name: string;
  description: string;
  analyteIds: string[];
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MethodColumnListDefault = {
  id: string;
  methodId: string;
  columnId: string;
  listId: string;
};

// ---- V3 Feature Types ----

export type RtAlignment = {
  id: string;
  batchId: string | null;
  referenceRunId: string | null;
  alignmentMethod: "landmark" | "linear";
  shiftJson: Record<string, number>;
  createdAt: string;
};

export type ISAssignment = {
  id: string;
  analyteId: string;
  isAnalyteId: string;
  methodId: string | null;
  createdAt: string;
};

export type SampleQueue = {
  id: string;
  name: string;
  batchId: string | null;
  instrument: string;
  createdBy: string | null;
  createdAt: string;
};

export type SampleQueueEntry = {
  id: string;
  queueId: string;
  position: number;
  sampleName: string;
  sampleType: "unknown" | "blank" | "standard" | "qc" | "double_blank" | "system_suitability";
  vialPosition: string;
  trayCode: string;
  methodPath: string;
  methodId: string | null;
  columnId: string | null;
  injectionVolume: number;
  dilutionFactor: number;
  status: "pending" | "running" | "complete" | "failed";
  runId: string | null;
  createdAt: string;
};

export type MethodTemplate = {
  id: string;
  name: string;
  description: string;
  templateJson: Partial<Method>;
  createdBy: string | null;
  createdAt: string;
};

export type ReportJob = {
  id: string;
  title: string;
  template: string;
  runIds: string[];
  batchId: string | null;
  includeSections: string[];
  outputFormat: "pdf" | "xlsx" | "csv";
  storagePath: string | null;
  emailTo: string[];
  emailSentAt: string | null;
  status: "pending" | "generating" | "ready" | "sent" | "failed";
  createdBy: string | null;
  createdAt: string;
};

export type AdductDetection = {
  id: string;
  peakId: string;
  analyteId: string | null;
  adductType: string;
  mzObserved: number;
  mzTheoretical: number;
  ppmError: number;
  isInSourceFragment: boolean;
  createdAt: string;
};

export type CustomColumn = {
  id: string;
  methodId: string | null;
  name: string;
  formula: string;
  unit: string;
  displayOrder: number;
  createdBy: string | null;
  createdAt: string;
};

export type ImportWatchFolder = {
  id: string;
  path: string;
  enabled: boolean;
  methodId: string | null;
  columnId: string | null;
  batchId: string | null;
  filePattern: string;
  createdBy: string | null;
  createdAt: string;
};

export type ImportedFile = {
  id: string;
  folderId: string;
  filePath: string;
  fileName: string;
  status: "pending" | "processing" | "imported" | "failed";
  runId: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type PeakDeconvolution = {
  id: string;
  peakId: string;
  componentCount: number;
  componentsJson: Array<{
    rt: number;
    area: number;
    height: number;
    fwhm: number;
    gaussianParams: [number, number, number];
  }>;
  createdAt: string;
};

export type NceOptimization = {
  id: string;
  analyteId: string;
  methodId: string | null;
  nceTested: number | null;
  bestNce: number | null;
  bestFragmentCount: number | null;
  spectraJson: Array<{
    nce: number;
    fragments: Array<{ mz: number; intensity: number }>;
  }>;
  notes: string;
  createdBy: string | null;
  createdAt: string;
};
