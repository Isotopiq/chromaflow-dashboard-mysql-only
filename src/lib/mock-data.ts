// Synthetic HPLC/MS data generators. Deterministic via simple seeded PRNG.

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Peak = {
  id: string;
  rt: number; // min
  area: number;
  height: number;
  fwhm: number; // min
  sn: number;
  mz?: number;
  mzLow?: number;
  mzHigh?: number;
  analyteId?: string;
  analyteName?: string;
  confidence?: number;
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
};

// ---------- Generators ----------

function gauss(x: number, mu: number, sigma: number, h: number) {
  const d = (x - mu) / sigma;
  return h * Math.exp(-0.5 * d * d);
}

export function generateChromatogram(
  seed: number,
  durationMin = 20,
  pointsPerMin = 30,
): { x: number[]; tic: number[]; bpc: number[]; peakSpecs: Array<{ mu: number; sigma: number; h: number }> } {
  const rng = mulberry32(seed);
  const n = Math.floor(durationMin * pointsPerMin);
  const x = Array.from({ length: n }, (_, i) => +(i / pointsPerMin).toFixed(3));
  const peakCount = 6 + Math.floor(rng() * 6);
  const peakSpecs = Array.from({ length: peakCount }, () => ({
    mu: 0.8 + rng() * (durationMin - 1.5),
    sigma: 0.04 + rng() * 0.18,
    h: 1e5 + rng() * 9e5,
  }));
  const tic = x.map((t) => {
    const baseline = 8000 + 4000 * Math.sin(t / 4) + 2000 * rng();
    const sig = peakSpecs.reduce((s, p) => s + gauss(t, p.mu, p.sigma, p.h), 0);
    return Math.max(0, baseline + sig);
  });
  const bpc = tic.map((v) => v * (0.45 + rng() * 0.2));
  return { x, tic, bpc, peakSpecs };
}

const ANALYTE_BANK: Analyte[] = [
  { id: "a1", name: "Caffeine", formula: "C8H10N4O2", mz: 195.0877, rtExpected: 3.42, class: "Alkaloid" },
  { id: "a2", name: "Theobromine", formula: "C7H8N4O2", mz: 181.072, rtExpected: 2.91, class: "Alkaloid" },
  { id: "a3", name: "Acetaminophen", formula: "C8H9NO2", mz: 152.0712, rtExpected: 2.05, class: "Analgesic" },
  { id: "a4", name: "Ibuprofen", formula: "C13H18O2", mz: 207.1385, rtExpected: 8.74, class: "NSAID" },
  { id: "a5", name: "Naproxen", formula: "C14H14O3", mz: 231.1021, rtExpected: 7.62, class: "NSAID" },
  { id: "a6", name: "Diclofenac", formula: "C14H11Cl2NO2", mz: 296.0245, rtExpected: 9.18, class: "NSAID" },
  { id: "a7", name: "Glutathione", formula: "C10H17N3O6S", mz: 308.0911, rtExpected: 1.34, class: "Peptide" },
  { id: "a8", name: "Tryptophan", formula: "C11H12N2O2", mz: 205.0972, rtExpected: 3.81, class: "Amino acid" },
  { id: "a9", name: "Phenylalanine", formula: "C9H11NO2", mz: 166.0863, rtExpected: 2.74, class: "Amino acid" },
  { id: "a10", name: "Tyrosine", formula: "C9H11NO3", mz: 182.0812, rtExpected: 2.21, class: "Amino acid" },
  { id: "a11", name: "Serotonin", formula: "C10H12N2O", mz: 177.1022, rtExpected: 4.16, class: "Neurotransmitter" },
  { id: "a12", name: "Dopamine", formula: "C8H11NO2", mz: 154.0863, rtExpected: 1.92, class: "Neurotransmitter" },
];

export const ANALYTES: Analyte[] = ANALYTE_BANK;

const COLUMN_BANK: Column[] = [
  {
    id: "c1",
    name: "Acquity BEH C18",
    chemistry: "C18",
    dimensions: "100 × 2.1 mm",
    particleSize: "1.7 µm",
    serial: "BEH-2024-0182",
    ratedInjections: 1500,
    injectionsUsed: 1124,
    installedAt: "2025-08-12",
    status: "warn",
    pressureTrend: [410, 415, 420, 428, 435, 440, 448, 455, 462, 470, 475, 480],
    notes: "Slight pressure rise after batch B-022. Consider guard column replacement.",
    manufacturer: "Waters",
  },
  {
    id: "c2",
    name: "Kinetex C18",
    chemistry: "C18 core-shell",
    dimensions: "150 × 3.0 mm",
    particleSize: "2.6 µm",
    serial: "KIN-2024-0091",
    ratedInjections: 2000,
    injectionsUsed: 412,
    installedAt: "2025-11-03",
    status: "healthy",
    pressureTrend: [280, 282, 281, 285, 284, 286, 288, 290, 289, 291, 292, 294],
    notes: "Primary column for impurity profiling.",
    manufacturer: "Phenomenex",
  },
  {
    id: "c3",
    name: "ZIC-HILIC",
    chemistry: "Zwitterionic HILIC",
    dimensions: "100 × 2.1 mm",
    particleSize: "3.5 µm",
    serial: "ZIC-2023-0045",
    ratedInjections: 1200,
    injectionsUsed: 1180,
    installedAt: "2025-04-21",
    status: "expired",
    pressureTrend: [180, 195, 220, 245, 280, 310, 340, 365, 390, 410, 430, 455],
    notes: "End of life — peak shape degraded. Replace before next batch.",
    manufacturer: "Merck",
  },
  {
    id: "c4",
    name: "Acquity HSS T3",
    chemistry: "C18 (T3)",
    dimensions: "100 × 2.1 mm",
    particleSize: "1.8 µm",
    serial: "HSS-2025-0214",
    ratedInjections: 1800,
    injectionsUsed: 86,
    installedAt: "2026-04-30",
    status: "healthy",
    pressureTrend: [320, 322, 321, 323, 322, 324, 325, 324, 326, 325, 327, 328],
    notes: "Newly installed for polar metabolite work.",
    manufacturer: "Waters",
  },
];

export const COLUMNS: Column[] = COLUMN_BANK;

export const USERS: User[] = [
  { id: "u1", name: "You (Method Dev)", email: "you@lab.io", role: "admin", avatar: "YO" },
  { id: "u2", name: "Maya Okafor", email: "maya@lab.io", role: "developer", avatar: "MO" },
  { id: "u3", name: "Daniel Reyes", email: "daniel@lab.io", role: "reviewer", avatar: "DR" },
  { id: "u4", name: "Priya Shah", email: "priya@lab.io", role: "developer", avatar: "PS" },
];

const METHODS: Method[] = [
  {
    id: "m1",
    name: "RP-LC-MS Polyphenols v3.2",
    modality: "RP-LC-MS",
    columnId: "c2",
    status: "validated",
    mobilePhaseA: "0.1% formic acid in water",
    mobilePhaseB: "0.1% formic acid in acetonitrile",
    gradient: [
      { time: 0, pctB: 5, flow: 0.4 },
      { time: 1, pctB: 5, flow: 0.4 },
      { time: 12, pctB: 95, flow: 0.4 },
      { time: 14, pctB: 95, flow: 0.4 },
      { time: 14.1, pctB: 5, flow: 0.4 },
      { time: 18, pctB: 5, flow: 0.4 },
    ],
    flowRate: 0.4,
    columnTemp: 40,
    injectionVolume: 2,
    detector: "Q-TOF, full scan 100–1200 m/z",
    msIonization: "ESI+",
    msScanRange: [100, 1200],
    notes:
      "Optimized gradient for catechins and flavonoid glycosides. Validated against in-house standards 2026-03.",
    createdBy: "u1",
    createdAt: "2026-02-14",
    updatedAt: "2026-05-02",
    tags: ["validated", "metabolomics", "natural products"],
    runIds: ["r1", "r2", "r5"],
  },
  {
    id: "m2",
    name: "HILIC Polar Metabolites v1.4",
    modality: "HILIC-MS",
    columnId: "c3",
    status: "draft",
    mobilePhaseA: "10 mM ammonium acetate, pH 9",
    mobilePhaseB: "Acetonitrile",
    gradient: [
      { time: 0, pctB: 95, flow: 0.3 },
      { time: 2, pctB: 95, flow: 0.3 },
      { time: 10, pctB: 40, flow: 0.3 },
      { time: 12, pctB: 40, flow: 0.3 },
      { time: 12.1, pctB: 95, flow: 0.3 },
      { time: 16, pctB: 95, flow: 0.3 },
    ],
    flowRate: 0.3,
    columnTemp: 35,
    injectionVolume: 5,
    detector: "Q-Exactive, full scan 70–700 m/z",
    msIonization: "ESI-",
    msScanRange: [70, 700],
    notes: "Working draft for amino acid + organic acid panel.",
    createdBy: "u2",
    createdAt: "2026-04-21",
    updatedAt: "2026-05-08",
    tags: ["draft", "polar"],
    runIds: ["r3"],
  },
  {
    id: "m3",
    name: "Impurity Profile API-X",
    modality: "RP-LC-MS",
    columnId: "c1",
    status: "validated",
    mobilePhaseA: "10 mM ammonium formate, pH 3.5",
    mobilePhaseB: "Methanol",
    gradient: [
      { time: 0, pctB: 10, flow: 0.35 },
      { time: 15, pctB: 90, flow: 0.35 },
      { time: 17, pctB: 90, flow: 0.35 },
      { time: 17.1, pctB: 10, flow: 0.35 },
      { time: 20, pctB: 10, flow: 0.35 },
    ],
    flowRate: 0.35,
    columnTemp: 45,
    injectionVolume: 3,
    detector: "DAD 210/254 nm + MS",
    msIonization: "ESI+",
    msScanRange: [150, 1500],
    notes: "ICH-validated impurity method for API-X release testing.",
    createdBy: "u1",
    createdAt: "2025-11-04",
    updatedAt: "2026-01-30",
    tags: ["validated", "QC", "release"],
    runIds: ["r4", "r6"],
  },
  {
    id: "m4",
    name: "Lipidomics Screening v0.9",
    modality: "RP-LC-MS",
    columnId: "c4",
    status: "draft",
    mobilePhaseA: "Acetonitrile/water 60/40 + 10 mM ammonium formate",
    mobilePhaseB: "Isopropanol/acetonitrile 90/10 + 10 mM ammonium formate",
    gradient: [
      { time: 0, pctB: 30, flow: 0.4 },
      { time: 2, pctB: 50, flow: 0.4 },
      { time: 15, pctB: 99, flow: 0.4 },
      { time: 18, pctB: 99, flow: 0.4 },
      { time: 18.1, pctB: 30, flow: 0.4 },
      { time: 22, pctB: 30, flow: 0.4 },
    ],
    flowRate: 0.4,
    columnTemp: 55,
    injectionVolume: 1,
    detector: "Q-TOF, full scan + DDA",
    msIonization: "ESI+",
    msScanRange: [200, 1800],
    notes: "Initial lipid class screen. Needs review.",
    createdBy: "u4",
    createdAt: "2026-05-01",
    updatedAt: "2026-05-10",
    tags: ["draft", "lipidomics"],
    runIds: [],
  },
];

export const METHODS_DATA: Method[] = METHODS;

function buildRun(
  id: string,
  name: string,
  methodId: string,
  columnId: string,
  seed: number,
  daysAgo: number,
  format: "mzML" | "mzXML" | "raw" = "mzML",
  ionMode: "positive" | "negative" = "positive",
  batchId?: string,
): Run {
  const chrom = generateChromatogram(seed, 18);
  const peaks: Peak[] = chrom.peakSpecs
    .map((p, i) => {
      const analyte = i < ANALYTES.length ? ANALYTES[(seed + i) % ANALYTES.length] : undefined;
      const annotated = i % 3 !== 2;
      return {
        id: `${id}-p${i}`,
        rt: +p.mu.toFixed(3),
        area: +(p.h * p.sigma * 2.5).toFixed(0),
        height: +p.h.toFixed(0),
        fwhm: +(p.sigma * 2.355).toFixed(3),
        sn: +(20 + (p.h / 1e5) * 8).toFixed(1),
        mz: analyte ? analyte.mz : undefined,
        analyteId: annotated ? analyte?.id : undefined,
        analyteName: annotated ? analyte?.name : undefined,
        confidence: annotated ? +(0.7 + (i % 4) * 0.07).toFixed(2) : undefined,
      };
    })
    .sort((a, b) => a.rt - b.rt);
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return {
    id,
    name,
    methodId,
    columnId,
    batchId,
    acquiredAt: date.toISOString(),
    fileFormat: format,
    fileSize: `${(8 + seed * 0.13).toFixed(1)} MB`,
    parsedStatus: "parsed",
    uploadedBy: "u1",
    trace: { x: chrom.x, tic: chrom.tic, bpc: chrom.bpc },
    peaks,
    ionMode,
  };
}

export const RUNS: Run[] = [
  buildRun("r1", "Polyphenols_StdMix_001.mzML", "m1", "c2", 11, 1, "mzML", "positive", "b1"),
  buildRun("r2", "Polyphenols_Sample_A12.mzML", "m1", "c2", 22, 2, "mzML", "positive", "b1"),
  buildRun("r3", "HILIC_Plasma_QC_03.mzML", "m2", "c3", 33, 3, "mzML", "negative", "b2"),
  buildRun("r4", "API-X_Impurity_lot248.mzML", "m3", "c1", 44, 5, "mzML", "positive", "b3"),
  buildRun("r5", "Polyphenols_Sample_B07.mzML", "m1", "c2", 55, 6, "mzML", "positive", "b1"),
  buildRun("r6", "API-X_Impurity_lot249.mzML", "m3", "c1", 66, 7, "mzML", "positive", "b3"),
  buildRun("r7", "HILIC_Plasma_QC_04.mzML", "m2", "c3", 77, 9, "mzML", "negative", "b2"),
  buildRun("r8", "Lipid_Screen_Pilot.mzML", "m4", "c4", 88, 11, "mzML", "positive"),
];

export const BATCHES: Batch[] = [
  {
    id: "b1",
    name: "Polyphenols Q2-2026",
    project: "Botanical Standards",
    startedAt: "2026-05-08",
    sampleCount: 24,
    runIds: ["r1", "r2", "r5"],
    status: "in_progress",
    owner: "u1",
  },
  {
    id: "b2",
    name: "Plasma Metabolomics Pilot",
    project: "Clinical Pilot 03",
    startedAt: "2026-05-04",
    sampleCount: 18,
    runIds: ["r3", "r7"],
    status: "review",
    owner: "u2",
  },
  {
    id: "b3",
    name: "API-X Release Lots 248-249",
    project: "API-X QC",
    startedAt: "2026-05-01",
    sampleCount: 12,
    runIds: ["r4", "r6"],
    status: "complete",
    owner: "u1",
  },
];

export function ago(iso: string) {
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const h = Math.floor(diff / 3.6e6);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export const CURRENT_USER = USERS[0];
