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
};

export type Run = {
  id: string;
  name: string;
  methodId: string;
  columnId: string;
  batchId?: string;
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
