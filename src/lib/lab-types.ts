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
};

export type GradientStep = { time: number; pctB: number; flow: number };

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
  msIonization: "ESI+" | "ESI-" | "APCI+" | "APCI-";
  msScanRange: [number, number];
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

export type Analyte = {
  id: string;
  name: string;
  formula: string;
  mz: number;
  rtExpected: number;
  class: string;
  createdBy?: string | null;
  librarySource?: string | null;
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
};

export type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "developer" | "reviewer";
  avatar: string;
  avatarUrl?: string | null;
};