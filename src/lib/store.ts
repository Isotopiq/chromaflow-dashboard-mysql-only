import { create } from "zustand";
import type { Method, Run, Column, Batch, Analyte, User, Peak, ColumnInjection, CompoundList, MethodColumnListDefault } from "./lab-types";

const EMPTY_USER: User = {
  id: "",
  name: "Loading…",
  email: "",
  role: "developer",
  avatar: "—",
  avatarUrl: null,
};

type State = {
  methods: Method[];
  runs: Run[];
  columns: Column[];
  batches: Batch[];
  analytes: Analyte[];
  users: User[];
  injections: ColumnInjection[];
  compoundLists: CompoundList[];
  listDefaults: MethodColumnListDefault[];
  currentUser: User;
  hydrated: boolean;
  setAll: (s: {
    methods: Method[];
    runs: Run[];
    columns: Column[];
    batches: Batch[];
    analytes: Analyte[];
    injections: ColumnInjection[];
    compoundLists: CompoundList[];
    listDefaults: MethodColumnListDefault[];
    currentUser: User;
  }) => void;
  upsertMethodLocal: (m: Method) => void;
  removeMethodLocal: (id: string) => void;
  archiveMethodLocal: (id: string) => void;
  upsertColumnLocal: (c: Column) => void;
  removeColumnLocal: (id: string) => void;
  upsertBatchLocal: (b: Batch) => void;
  upsertRunLocal: (r: Run) => void;
  addAnalyteLocal: (a: Analyte) => void;
  updateAnalyteLocal: (a: Analyte) => void;
  removeAnalyteLocal: (id: string) => void;
  annotatePeakLocal: (runId: string, peakId: string, label: string, analyteId?: string) => void;
  unassignPeaksLocal: (runId: string, peakIds: string[]) => void;
  addPeakLocal: (runId: string, peak: Peak) => void;
  removeRunLocal: (id: string) => void;
  removeBatchLocal: (id: string) => void;
  updateBatchNotesLocal: (batchId: string, notes: string) => void;
  updateRunNotesLocal: (runId: string, notes: string) => void;
  updateRunNameLocal: (runId: string, name: string) => void;
  updatePeakNotesLocal: (runId: string, peakId: string, notes: string) => void;
  setRunBatchLocal: (runId: string, batchId: string | null) => void;
  upsertInjectionLocal: (i: ColumnInjection) => void;
  removeInjectionLocal: (id: string) => void;
  upsertCompoundListLocal: (cl: CompoundList) => void;
  removeCompoundListLocal: (id: string) => void;
  setListDefaultLocal: (d: MethodColumnListDefault | null, methodId: string, columnId: string) => void;
};

export const useLab = create<State>((set) => ({
  methods: [],
  runs: [],
  columns: [],
  batches: [],
  analytes: [],
  users: [],
  injections: [],
  compoundLists: [],
  listDefaults: [],
  currentUser: EMPTY_USER,
  hydrated: false,
  setAll: (s) =>
    set(() => ({
      methods: s.methods,
      runs: s.runs,
      columns: s.columns,
      batches: s.batches,
      analytes: s.analytes,
      injections: s.injections,
      compoundLists: s.compoundLists,
      listDefaults: s.listDefaults,
      currentUser: s.currentUser,
      hydrated: true,
    })),
  upsertMethodLocal: (m) =>
    set((s) => ({
      methods: s.methods.some((x) => x.id === m.id)
        ? s.methods.map((x) => (x.id === m.id ? m : x))
        : [m, ...s.methods],
    })),
  removeMethodLocal: (id) =>
    set((s) => ({ methods: s.methods.filter((m) => m.id !== id) })),
  archiveMethodLocal: (id) =>
    set((s) => ({
      methods: s.methods.map((m) =>
        m.id === id ? { ...m, status: "archived" as const } : m,
      ),
    })),
  upsertColumnLocal: (c) =>
    set((s) => ({
      columns: s.columns.some((x) => x.id === c.id)
        ? s.columns.map((x) => (x.id === c.id ? c : x))
        : [c, ...s.columns],
    })),
  removeColumnLocal: (id) =>
    set((s) => ({ columns: s.columns.filter((c) => c.id !== id) })),
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
  updateAnalyteLocal: (a) =>
    set((s) => ({ analytes: s.analytes.map((x) => (x.id === a.id ? a : x)) })),
  removeAnalyteLocal: (id) =>
    set((s) => ({ analytes: s.analytes.filter((x) => x.id !== id) })),
  addPeakLocal: (runId, peak) =>
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId
          ? { ...r, peaks: [...r.peaks, peak].sort((a, b) => a.rt - b.rt) }
          : r,
      ),
    })),
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
  unassignPeaksLocal: (runId, peakIds) =>
    set((s) => {
      const ids = new Set(peakIds);
      return {
        runs: s.runs.map((r) =>
          r.id === runId
            ? {
                ...r,
                peaks: r.peaks.map((p) =>
                  ids.has(p.id)
                    ? { ...p, analyteName: undefined, analyteId: undefined, confidence: undefined }
                    : p,
                ),
              }
            : r,
        ),
      };
    }),
  removeRunLocal: (id) =>
    set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),
  removeBatchLocal: (id) =>
    set((s) => ({
      batches: s.batches.filter((b) => b.id !== id),
      runs: s.runs.map((r) => (r.batchId === id ? { ...r, batchId: undefined } : r)),
    })),
  updateBatchNotesLocal: (batchId, notes) =>
    set((s) => ({
      batches: s.batches.map((b) => (b.id === batchId ? { ...b, notes } : b)),
    })),
  updateRunNotesLocal: (runId, notes) =>
    set((s) => ({
      runs: s.runs.map((r) => (r.id === runId ? { ...r, notes } : r)),
    })),
  updateRunNameLocal: (runId, name) =>
    set((s) => ({
      runs: s.runs.map((r) => (r.id === runId ? { ...r, name } : r)),
    })),
  updatePeakNotesLocal: (runId, peakId, notes) =>
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId
          ? { ...r, peaks: r.peaks.map((p) => (p.id === peakId ? { ...p, notes } : p)) }
          : r,
      ),
    })),
  setRunBatchLocal: (runId, batchId) =>
    set((s) => ({
      runs: s.runs.map((r) => (r.id === runId ? { ...r, batchId: batchId ?? undefined } : r)),
    })),
  upsertInjectionLocal: (i) =>
    set((s) => ({
      injections: s.injections.some((x) => x.id === i.id)
        ? s.injections.map((x) => (x.id === i.id ? i : x))
        : [...s.injections, i],
    })),
  removeInjectionLocal: (id) =>
    set((s) => ({ injections: s.injections.filter((x) => x.id !== id) })),
  upsertCompoundListLocal: (cl) =>
    set((s) => ({
      compoundLists: s.compoundLists.some((x) => x.id === cl.id)
        ? s.compoundLists.map((x) => (x.id === cl.id ? cl : x))
        : [...s.compoundLists, cl],
    })),
  removeCompoundListLocal: (id) =>
    set((s) => ({
      compoundLists: s.compoundLists.filter((x) => x.id !== id),
      listDefaults: s.listDefaults.filter((d) => d.listId !== id),
    })),
  setListDefaultLocal: (d, methodId, columnId) =>
    set((s) => {
      const filtered = s.listDefaults.filter(
        (x) => !(x.methodId === methodId && x.columnId === columnId),
      );
      return { listDefaults: d ? [...filtered, d] : filtered };
    }),
}));

// Backwards-compat helpers used by older pages — they map to *Local + server fn.
import { useServerFn } from "@tanstack/react-start";
import {
  upsertMethod as upsertMethodFn,
  annotatePeak as annotatePeakFn,
  uploadMethodFile as uploadMethodFileFn,
  downloadMethodFile as downloadMethodFileFn,
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

export function useUploadMethodFile() {
  const fn = useServerFn(uploadMethodFileFn);
  return fn;
}

export function useDownloadMethodFile() {
  const fn = useServerFn(downloadMethodFileFn);
  return fn;
}

export function useAnnotatePeak() {
  const fn = useServerFn(annotatePeakFn);
  const local = useLab((s) => s.annotatePeakLocal);
  return async (runId: string, peakId: string, label: string, analyteId?: string) => {
    await fn({ data: { runId, peakId, label, analyteId: analyteId ?? null } });
    local(runId, peakId, label, analyteId);
  };
}
