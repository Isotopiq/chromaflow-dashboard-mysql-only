import { create } from "zustand";
import {
  ANALYTES,
  type Method,
  type Run,
  type Column,
  type Batch,
  type Analyte,
  type User,
  CURRENT_USER,
} from "./mock-data";

type State = {
  methods: Method[];
  runs: Run[];
  columns: Column[];
  batches: Batch[];
  analytes: Analyte[];
  users: User[];
  currentUser: User;
  hydrated: boolean;
  setAll: (s: {
    methods: Method[];
    runs: Run[];
    columns: Column[];
    batches: Batch[];
    analytes: Analyte[];
    currentUser: User;
  }) => void;
  upsertMethodLocal: (m: Method) => void;
  upsertColumnLocal: (c: Column) => void;
  upsertBatchLocal: (b: Batch) => void;
  upsertRunLocal: (r: Run) => void;
  addAnalyteLocal: (a: Analyte) => void;
  updateAnalyteLocal: (a: Analyte) => void;
  removeAnalyteLocal: (id: string) => void;
  annotatePeakLocal: (runId: string, peakId: string, label: string, analyteId?: string) => void;
  removeRunLocal: (id: string) => void;
  removeBatchLocal: (id: string) => void;
};

export const useLab = create<State>((set) => ({
  methods: [],
  runs: [],
  columns: [],
  batches: [],
  analytes: ANALYTES,
  users: [],
  currentUser: CURRENT_USER,
  hydrated: false,
  setAll: (s) =>
    set(() => ({
      methods: s.methods,
      runs: s.runs,
      columns: s.columns,
      batches: s.batches,
      analytes: s.analytes.length ? s.analytes : ANALYTES,
      currentUser: s.currentUser,
      hydrated: true,
    })),
  upsertMethodLocal: (m) =>
    set((s) => ({
      methods: s.methods.some((x) => x.id === m.id)
        ? s.methods.map((x) => (x.id === m.id ? m : x))
        : [m, ...s.methods],
    })),
  upsertColumnLocal: (c) =>
    set((s) => ({
      columns: s.columns.some((x) => x.id === c.id)
        ? s.columns.map((x) => (x.id === c.id ? c : x))
        : [c, ...s.columns],
    })),
  upsertBatchLocal: (b) =>
    set((s) => ({
      batches: s.batches.some((x) => x.id === b.id)
        ? s.batches.map((x) => (x.id === b.id ? b : x))
        : [b, ...s.batches],
    })),
  upsertRunLocal: (r) =>
    set((s) => ({
      runs: s.runs.some((x) => x.id === r.id)
        ? s.runs.map((x) => (x.id === r.id ? r : x))
        : [r, ...s.runs],
    })),
  addAnalyteLocal: (a) =>
    set((s) => ({ analytes: [a, ...s.analytes] })),
  annotatePeakLocal: (runId, peakId, label, analyteId) =>
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId
          ? {
              ...r,
              peaks: r.peaks.map((p) =>
                p.id === peakId
                  ? { ...p, analyteName: label, analyteId, confidence: 1 }
                  : p,
              ),
            }
          : r,
      ),
    })),
  removeRunLocal: (id) =>
    set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),
  removeBatchLocal: (id) =>
    set((s) => ({
      batches: s.batches.filter((b) => b.id !== id),
      runs: s.runs.map((r) => (r.batchId === id ? { ...r, batchId: undefined } : r)),
    })),
}));

// Backwards-compat helpers used by older pages — they map to *Local + server fn.
import { useServerFn } from "@tanstack/react-start";
import {
  upsertMethod as upsertMethodFn,
  annotatePeak as annotatePeakFn,
} from "./lab.functions";

export function useUpsertMethod() {
  const fn = useServerFn(upsertMethodFn);
  const upsert = useLab((s) => s.upsertMethodLocal);
  return async (m: Method) => {
    const saved = await fn({ data: m as any });
    upsert(saved);
    return saved;
  };
}

export function useAnnotatePeak() {
  const fn = useServerFn(annotatePeakFn);
  const local = useLab((s) => s.annotatePeakLocal);
  return async (runId: string, peakId: string, label: string, analyteId?: string) => {
    await fn({ data: { runId, peakId, label, analyteId: analyteId ?? null } });
    local(runId, peakId, label, analyteId);
  };
}
