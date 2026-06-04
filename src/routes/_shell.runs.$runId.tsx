import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useLab, useAnnotatePeak } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Sparkles, Download, Activity, Trash2, Share2 } from "lucide-react";
import { ShareDialog } from "@/components/share-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { PeakTable } from "@/components/peak-table";
import { ago } from "@/lib/time";
import { toast } from "sonner";
import { getRunEIC, getRunEICBatch, deleteRun, addManualPeak, unassignPeaks } from "@/lib/lab.functions";
import { integrateBand, type IntegrationResult } from "@/lib/peak-math";
import { mzFromFormula, defaultAdduct, ADDUCTS_POS, ADDUCTS_NEG, type Adduct } from "@/lib/chem";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_shell/runs/$runId")({
  component: RunDetail,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Run not found.</div>
  ),
});

function RunDetail() {
  const { runId } = Route.useParams();
  const { runs, methods, columns, analytes } = useLab();
  const annotatePeak = useAnnotatePeak();
  const removeRunLocal = useLab((s) => s.removeRunLocal);
  const deleteRunFn = useServerFn(deleteRun);
  const nav = useNavigate();
  const run = runs.find((r) => r.id === runId);
  if (!run) throw notFound();
  const method = methods.find((m) => m.id === run.methodId);
  const column = columns.find((c) => c.id === run.columnId);
  const [selectedId, setSelected] = useState<string | undefined>(run.peaks[0]?.id);
  const [selectedTargetId, setSelectedTargetId] = useState<string | undefined>(undefined);
  const [selectedTargetName, setSelectedTargetName] = useState<string | undefined>(undefined);
  const [annotation, setAnnotation] = useState("");
  const [ppm, setPpm] = useState(10);
  const [customMz, setCustomMz] = useState("");
  const [integrateMode, setIntegrateMode] = useState(false);
  const [integration, setIntegration] = useState<IntegrationResult | null>(null);
  const addPeakLocal = useLab((s) => s.addPeakLocal);
  const addManualPeakFn = useServerFn(addManualPeak);
  const unassignPeaksLocal = useLab((s) => s.unassignPeaksLocal);
  const unassignPeaksFn = useServerFn(unassignPeaks);
  const handleUnassign = async (peakIds: string[]) => {
    try {
      await unassignPeaksFn({ data: { runId: run.id, peakIds } });
      unassignPeaksLocal(run.id, peakIds);
      toast.success(
        peakIds.length === 1
          ? "Assignment cleared"
          : `${peakIds.length} assignments cleared`,
      );
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to clear assignment");
    }
  };

  const selected = run.peaks.find((p) => p.id === selectedId);
  // Custom m/z (when typed and valid) ALWAYS overrides the selected peak.
  const customMzNum = customMz.trim() ? parseFloat(customMz) : NaN;
  const eicMz: number | null = Number.isFinite(customMzNum)
    ? customMzNum
    : selected?.mz != null && Number.isFinite(selected.mz)
      ? (selected.mz as number)
      : null;

  const fetchEIC = useServerFn(getRunEIC);
  const eicQuery = useQuery({
    queryKey: ["eic", run.id, eicMz, ppm],
    enabled: eicMz != null && Number.isFinite(eicMz) && !!run.scansBlobPath,
    queryFn: () => fetchEIC({ data: { runId: run.id, mz: eicMz!, ppm } }),
    staleTime: 60_000,
  });

  // ---- Auto-XIC from analyte library ----
  const [polarity, setPolarity] = useState<"positive" | "negative">(
    run.ionMode === "negative" ? "negative" : "positive",
  );
  const adductOptions: Adduct[] = polarity === "negative" ? ADDUCTS_NEG : ADDUCTS_POS;
  const [adduct, setAdduct] = useState<Adduct>(defaultAdduct(polarity));
  useEffect(() => {
    if (!adductOptions.includes(adduct)) setAdduct(defaultAdduct(polarity));
  }, [polarity, adductOptions, adduct]);
  const [rtTol, setRtTol] = useState(1.0);

  const eicCardRef = useRef<HTMLDivElement | null>(null);
  const onSelectPeak = (id: string) => {
    setSelected(id);
    setSelectedTargetId(undefined);
    setSelectedTargetName(undefined);
    setCustomMz("");
    requestAnimationFrame(() => {
      eicCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const libraryTargets = useMemo(() => {
    return analytes
      .map((a) => {
        // Prefer recomputed m/z from formula+adduct; fall back to analyte.mz.
        const computed = a.formula ? mzFromFormula(a.formula, adduct) : null;
        const mz = computed ?? (Number.isFinite(a.mz) ? a.mz : null);
        return mz != null ? { id: a.id, name: a.name, formula: a.formula, mz, rtExpected: a.rtExpected } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [analytes, adduct]);

  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  // Initialize selection on first render to all targets within a reasonable mass range.
  useMemo(() => {
    if (enabledIds.size === 0 && libraryTargets.length > 0) {
      setEnabledIds(new Set(libraryTargets.slice(0, 8).map((t) => t.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryTargets.length]);

  const fetchBatch = useServerFn(getRunEICBatch);
  const activeTargets = libraryTargets.filter((t) => enabledIds.has(t.id));
  const batchKey = activeTargets.map((t) => `${t.id}:${t.mz.toFixed(4)}`).join("|");
  const batchQuery = useQuery({
    queryKey: ["eic-batch", run.id, batchKey, ppm],
    enabled: activeTargets.length > 0 && !!run.scansBlobPath,
    queryFn: () =>
      fetchBatch({
        data: {
          runId: run.id,
          ppm,
          targets: activeTargets.map((t) => ({ id: t.id, mz: t.mz })),
        },
      }),
    staleTime: 60_000,
  });

  const overlayRuns = useMemo(() => {
    if (!batchQuery.data) return [];
    const x = batchQuery.data.x;
    return batchQuery.data.traces.map((tr) => {
      const t = activeTargets.find((a) => a.id === tr.id);
      return {
        id: tr.id,
        name: t ? `${t.name} (${tr.mz.toFixed(4)})` : tr.mz.toFixed(4),
        trace: { x, tic: tr.y, bpc: tr.y },
      };
    });
  }, [batchQuery.data, activeTargets]);

  const matchRows = useMemo(() => {
    if (!batchQuery.data) return [];
    return batchQuery.data.traces.map((tr) => {
      const t = activeTargets.find((a) => a.id === tr.id);
      const dRt = t && tr.peakRt != null ? Math.abs(tr.peakRt - t.rtExpected) : null;
      const matched = tr.peakIntensity > 0 && (dRt == null || dRt <= rtTol);
      return { tr, t, dRt, matched };
    });
  }, [batchQuery.data, activeTargets, rtTol]);

  // EIC trace: prefer the batch result for the selected analyte; otherwise the on-demand fetch.
  const eicTrace = useMemo(() => {
    if (selectedTargetId && batchQuery.data) {
      const tr = batchQuery.data.traces.find((t) => t.id === selectedTargetId);
      if (tr && batchQuery.data.x.length > 0) {
        return {
          id: `eic-${tr.id}`,
          name: selectedTargetName
            ? `${selectedTargetName} (m/z ${tr.mz.toFixed(4)})`
            : `EIC m/z ${tr.mz.toFixed(4)}`,
          trace: { x: batchQuery.data.x, tic: tr.y, bpc: tr.y },
        };
      }
    }
    if (!eicQuery.data) return null;
    return {
      id: `eic-${eicMz}`,
      name: `EIC m/z ${eicMz?.toFixed(4)} ±${ppm} ppm`,
      trace: { x: eicQuery.data.x, tic: eicQuery.data.y, bpc: eicQuery.data.y },
    };
  }, [eicQuery.data, eicMz, ppm, selectedTargetId, selectedTargetName, batchQuery.data]);
  const eicTraceHasPoints = !!eicTrace && eicTrace.trace.x.length > 0;
  const eicTraceHasSignal = !!eicTrace && eicTrace.trace.tic.some((v) => Number.isFinite(v) && v > 0);
  const eicErrorMessage = eicQuery.error instanceof Error ? eicQuery.error.message : "Failed to extract EIC.";
  const batchErrorMessage = batchQuery.error instanceof Error ? batchQuery.error.message : "Failed to extract Auto-XIC traces.";

  // Synthesized peaks from auto-XIC when the run has no detected peaks of its own.
  const derivedPeaks = useMemo(() => {
    if (run.peaks.length > 0 || !batchQuery.data) return [] as typeof run.peaks;
    return matchRows
      .filter(({ tr }) => tr.peakIntensity > 0 && tr.peakRt != null)
      .map(({ tr, t }) => ({
        id: `eic-${tr.id}`,
        rt: tr.peakRt as number,
        area: (tr as any).area ?? 0,
        height: (tr as any).height ?? tr.peakIntensity,
        fwhm: (tr as any).fwhm ?? 0,
        sn: (tr as any).sn ?? 0,
        mz: tr.mz,
        mzLow: tr.mzLow,
        mzHigh: tr.mzHigh,
        analyteId: t?.id,
        analyteName: t?.name,
        confidence: 1,
      })) as typeof run.peaks;
  }, [run.peaks, batchQuery.data, matchRows]);

  const usingDerivedPeaks = run.peaks.length === 0 && derivedPeaks.length > 0;
  const peaksForTable = usingDerivedPeaks ? derivedPeaks : run.peaks;
  const selectedDerived = derivedPeaks.find((p) => p.id === selectedId);
  const effectiveSelected = selected ?? selectedDerived;

  const onSelectTarget = (targetId: string, name?: string, mz?: number) => {
    setSelectedTargetId(targetId);
    setSelectedTargetName(name);
    setSelected(`eic-${targetId}`);
    if (mz != null) setCustomMz(mz.toFixed(4));
    requestAnimationFrame(() => {
      eicCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };



  const suggested = analytes
    .map((a) => {
      const dRt = Math.abs(a.rtExpected - (selected?.rt ?? 0));
      const dPpm = selected?.mz ? Math.abs((a.mz - selected.mz) / a.mz) * 1e6 : 999;
      return { a, dRt, dPpm, score: dRt * 10 + Math.min(dPpm, 100) / 5 };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 4);

  const downloadCsv = () => {
    const header = "rt,area,height,fwhm,sn,mz,mz_low,mz_high,annotation\n";
    const body = run.peaks
      .map(
        (p) =>
          `${p.rt},${p.area},${p.height},${p.fwhm},${p.sn},${p.mz ?? ""},${p.mzLow ?? ""},${p.mzHigh ?? ""},${p.analyteName ?? ""}`,
      )
      .join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.name}.peaks.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadEicCsv = () => {
    if (!eicQuery.data) return;
    const header = "rt,intensity\n";
    const body = eicQuery.data.x.map((x, i) => `${x},${eicQuery.data!.y[i]}`).join("\n");
    const blob = new Blob([header + body], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${run.name}.eic_${eicMz?.toFixed(4)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link to="/runs" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3 w-3" /> All runs
          </Link>
          <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight">{run.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{method?.name}</span>·<span>{column?.name}</span>·
            <Badge variant="outline" className="text-[10px]">
              {run.ionMode === "positive" ? "ESI +" : "ESI −"}
            </Badge>
            <span>·</span><span>{run.fileSize}</span>·<span>{ago(run.acquiredAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <Download className="mr-1 h-3.5 w-3.5" /> Peaks CSV
          </Button>
          <ShareDialog
            resourceKind="run"
            resourceId={run.id}
            trigger={
              <Button variant="outline" size="sm">
                <Share2 className="mr-1 h-3.5 w-3.5" /> Share
              </Button>
            }
          />
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete run
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this run?</AlertDialogTitle>
                <AlertDialogDescription>
                  Permanently removes <span className="font-mono">{run.name}</span>, its
                  peaks, and uploaded raw / scan files. This can't be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={async () => {
                    try {
                      await deleteRunFn({ data: { runId: run.id } });
                      removeRunLocal(run.id);
                      toast.success(`Deleted ${run.name}`);
                      nav({ to: "/runs" });
                    } catch (e: any) {
                      toast.error(e?.message ?? "Failed to delete run");
                    }
                  }}
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Card className="border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">TIC chromatogram</div>
          <div className="text-[10px] text-muted-foreground">
            {run.peaks.length} peaks ·{" "}
            <span className="text-[color:var(--peak-annotated)]">
              {run.peaks.filter((p) => p.analyteName).length} annotated
            </span>
          </div>
        </div>
        <ChromatogramPlot runs={[run]} height={260} showPeaks />
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Auto-XIC from analyte library
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              Pick compounds — m/z is computed from formula + adduct, then EICs are extracted in one pass.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mode</span>
              <Select value={polarity} onValueChange={(v) => setPolarity(v as "positive" | "negative")}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="positive" className="text-xs">ESI +</SelectItem>
                  <SelectItem value="negative" className="text-xs">ESI −</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Adduct</span>
              <Select value={adduct} onValueChange={(v) => setAdduct(v as Adduct)}>
                <SelectTrigger className="h-8 w-32 font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {adductOptions.map((a) => (
                    <SelectItem key={a} value={a} className="font-mono text-xs">
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-44 items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">RT tol</span>
              <Slider
                value={[rtTol]}
                onValueChange={(v) => setRtTol(v[0])}
                min={0.1}
                max={3}
                step={0.1}
              />
              <span className="w-8 text-right font-mono text-[10px]">{rtTol.toFixed(1)}</span>
            </div>
          </div>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {libraryTargets.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              No analytes in library. Add analytes manually or upload a CSV from the Analytes page.
            </div>
          ) : (
            libraryTargets.map((t) => {
              const checked = enabledIds.has(t.id);
              return (
                <label
                  key={t.id}
                  className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                    checked ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      const next = new Set(enabledIds);
                      if (v) next.add(t.id);
                      else next.delete(t.id);
                      setEnabledIds(next);
                    }}
                  />
                  <span>{t.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {t.mz.toFixed(4)}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {!run.scansBlobPath ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> Auto-XIC unavailable: this run has no persisted scans blob.
          </div>
        ) : activeTargets.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Select one or more analytes to overlay their EICs.
          </div>
        ) : batchQuery.isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Extracting {activeTargets.length} EICs…</div>
        ) : batchQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {batchErrorMessage}
          </div>
        ) : overlayRuns.length > 0 ? (
          <>
            <ChromatogramPlot runs={overlayRuns} height={260} channel="tic" />
            <div className="mt-3 overflow-x-auto rounded-md border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="text-[10px] uppercase tracking-wider">Analyte</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Formula</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">m/z</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">RT obs</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">RT exp</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">ΔRT</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Intensity</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matchRows.map(({ tr, t, dRt, matched }) => (
                    <TableRow
                      key={tr.id}
                      onClick={() => onSelectTarget(tr.id, t?.name, tr.mz)}
                      className={`cursor-pointer text-xs ${selectedTargetId === tr.id ? "bg-accent/40" : ""}`}
                    >
                      <TableCell className="font-medium">{t?.name ?? "—"}</TableCell>
                      <TableCell className="font-mono text-muted-foreground">{t?.formula ?? "—"}</TableCell>
                      <TableCell className="font-mono">{tr.mz.toFixed(4)}</TableCell>
                      <TableCell className="font-mono">
                        {tr.peakRt != null ? tr.peakRt.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">
                        {t?.rtExpected.toFixed(2) ?? "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {dRt != null ? dRt.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="font-mono">
                        {tr.peakIntensity > 0
                          ? tr.peakIntensity >= 1000
                            ? `${(tr.peakIntensity / 1000).toFixed(1)}k`
                            : tr.peakIntensity.toFixed(0)
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {tr.peakIntensity <= 0 ? (
                          <Badge variant="outline" className="text-[10px]">no peak</Badge>
                        ) : matched ? (
                          <Badge className="bg-[color:var(--peak-annotated)]/20 text-[10px] text-[color:var(--peak-annotated)]">
                            match
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">drift</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </Card>

      <Card ref={eicCardRef} className="border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Extracted ion chromatogram (EIC)
            </div>
            <div className="mt-0.5 font-mono text-xs">
              {eicMz != null ? (
                <>m/z {eicMz.toFixed(4)} · ±{ppm} ppm
                  {selected && <span className="text-muted-foreground"> · peak RT {selected.rt.toFixed(2)} min</span>}
                  {eicQuery.data && (
                    <span className="text-muted-foreground"> · window [{eicQuery.data.mzLow.toFixed(4)} – {eicQuery.data.mzHigh.toFixed(4)}]</span>
                  )}
                </>
              ) : selected ? (
                <span className="text-muted-foreground">
                  Selected peak at RT {selected.rt.toFixed(2)} min has no associated m/z. Type a custom m/z to extract its EIC.
                </span>
              ) : (
                <span className="text-muted-foreground">Click a peak to view its EIC, or enter a custom m/z below.</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex w-44 items-center gap-2">
              <span className="text-[10px] text-muted-foreground">ppm</span>
              <Slider
                value={[ppm]}
                onValueChange={(v) => setPpm(v[0])}
                min={2}
                max={50}
                step={1}
              />
              <span className="w-6 text-right font-mono text-[10px]">{ppm}</span>
            </div>
            <Input
              value={customMz}
              onChange={(e) => setCustomMz(e.target.value)}
              placeholder="custom m/z"
              className="h-8 w-28 font-mono text-xs"
            />
            <Button size="sm" variant="outline" onClick={downloadEicCsv} disabled={!eicQuery.data}>
              <Download className="mr-1 h-3.5 w-3.5" /> CSV
            </Button>
          </div>
        </div>
        {!run.scansBlobPath ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5" /> EIC unavailable: this run has no persisted scans blob (uploaded before EIC support).
          </div>
        ) : eicMz == null ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            {selected
              ? `Selected peak at RT ${selected.rt.toFixed(2)} min has no associated m/z. Enter a custom m/z above to extract its ion chromatogram, or pick a compound from the library section above.`
              : "Select a peak from the table below to extract its ion chromatogram."}
          </div>
        ) : eicQuery.isLoading && !eicTraceHasPoints ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Extracting EIC…</div>
        ) : eicQuery.isError && !eicTraceHasPoints ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            {eicErrorMessage}
          </div>
        ) : eicTraceHasPoints && !eicTraceHasSignal ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No ion signal found in this m/z window. Try a wider ppm tolerance or verify the adduct / ion mode.
          </div>
        ) : eicTraceHasPoints ? (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                <button
                  onClick={() => setIntegrateMode(false)}
                  className={`rounded-md border px-2 py-1 ${!integrateMode ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                >
                  Auto
                </button>
                <button
                  onClick={() => setIntegrateMode(true)}
                  className={`rounded-md border px-2 py-1 ${integrateMode ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                >
                  Integrate (drag)
                </button>
              </div>
              {integration && (
                <div className="flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground">
                  <span>RT [{integration.rtStart.toFixed(2)}, {integration.rtEnd.toFixed(2)}]</span>
                  <span>apex {integration.apexRt.toFixed(2)}</span>
                  <span>height {integration.height.toFixed(0)}</span>
                  <span>area {integration.area.toFixed(0)}</span>
                  <span>FWHM {integration.fwhm.toFixed(3)}</span>
                  <span>S/N {integration.sn.toFixed(1)}</span>
                  <Button size="sm" variant="outline" onClick={() => setIntegration(null)}>Reset</Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        const { peak } = await addManualPeakFn({
                          data: {
                            runId: run.id,
                            rt: integration.apexRt,
                            rtStart: integration.rtStart,
                            rtEnd: integration.rtEnd,
                            area: integration.area,
                            height: integration.height,
                            fwhm: integration.fwhm,
                            sn: integration.sn,
                            mz: eicMz ?? null,
                            mzLow: eicMz != null ? eicMz - (eicMz * ppm) / 1e6 : null,
                            mzHigh: eicMz != null ? eicMz + (eicMz * ppm) / 1e6 : null,
                            analyteName: selectedTargetName ?? null,
                          },
                        });
                        addPeakLocal(run.id, peak);
                        toast.success("Manual peak saved");
                        setIntegration(null);
                        setIntegrateMode(false);
                      } catch (e: any) {
                        toast.error(e?.message ?? "Failed to save peak");
                      }
                    }}
                  >
                    Save as peak
                  </Button>
                </div>
              )}
            </div>
            <ChromatogramPlot
              runs={[eicTrace]}
              height={220}
              channel="tic"
              onSelectRange={
                integrateMode
                  ? (a, b) => {
                      const r = integrateBand(eicTrace.trace.x, eicTrace.trace.tic, a, b);
                      if (r) setIntegration(r);
                    }
                  : undefined
              }
              selectionBand={integration ? { x1: integration.rtStart, x2: integration.rtEnd } : null}
              baseline={
                integration
                  ? { x1: integration.rtStart, y1: integration.baselineLeft, x2: integration.rtEnd, y2: integration.baselineRight }
                  : null
              }
            />
          </>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card p-0 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Peak table</div>
              <h2 className="text-sm font-semibold">
                {usingDerivedPeaks
                  ? "Detected peaks (from Auto-XIC) — click any row to extract its EIC"
                  : "Detected peaks — click any row to extract its EIC"}
              </h2>
            </div>
            {usingDerivedPeaks && (
              <Badge variant="outline" className="text-[10px]">derived</Badge>
            )}
          </div>
          <div className="p-3">
            {peaksForTable.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No peaks detected on the raw run, and no Auto-XIC matches yet. Pick analytes above to extract candidate peaks.
              </div>
            ) : (
              <PeakTable
                peaks={peaksForTable}
                selectedId={selectedId}
                onSelect={(p) => {
                  if (p.id.startsWith("eic-") && p.analyteId) {
                    onSelectTarget(p.analyteId, p.analyteName, p.mz ?? undefined);
                  } else {
                    onSelectPeak(p.id);
                  }
                }}
                onUnassign={usingDerivedPeaks ? undefined : handleUnassign}
              />
            )}
          </div>
        </Card>

        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Annotation</div>
          {effectiveSelected ? (
            <>
              <div className="mt-2 font-mono text-xs">
                <div>RT {effectiveSelected.rt.toFixed(2)} min</div>
                <div className="text-muted-foreground">m/z {effectiveSelected.mz?.toFixed(4) ?? "—"}</div>
                {effectiveSelected.mzLow != null && (
                  <div className="text-muted-foreground">±{ppm} ppm: [{effectiveSelected.mzLow.toFixed(4)}, {effectiveSelected.mzHigh?.toFixed(4)}]</div>
                )}
                {effectiveSelected.analyteName && (
                  <div className="mt-1">
                    <Badge className="bg-[color:var(--peak-annotated)]/20 text-[10px] text-[color:var(--peak-annotated)]">
                      {effectiveSelected.analyteName}
                    </Badge>
                  </div>
                )}
              </div>

              {usingDerivedPeaks ? (
                <div className="mt-4 rounded-md border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                  This peak was extracted from the analyte library, not picked from the raw run. Run peak detection on this run to enable persistent annotation.
                </div>
              ) : (
                <>
                  <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
                    Suggested matches (RT + m/z)
                  </div>
                  <div className="mt-2 space-y-1">
                    {suggested.map(({ a, dRt, dPpm }) => (
                      <button
                        key={a.id}
                        onClick={async () => {
                          if (!selected) return;
                          try {
                            await annotatePeak(run.id, selected.id, a.name, a.id);
                            toast.success(`Annotated as ${a.name}`);
                          } catch (err: any) {
                            toast.error(err?.message ?? "Failed");
                          }
                        }}
                        className="flex w-full items-center justify-between rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-left text-xs hover:border-primary/60"
                      >
                        <div>
                          <div className="font-medium">{a.name}</div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {a.formula} · {a.mz.toFixed(4)}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-0.5">
                          <Badge variant="outline" className="text-[10px]">ΔRT {dRt.toFixed(2)}</Badge>
                          <span className="font-mono text-[9px] text-muted-foreground">
                            {dPpm < 999 ? `${dPpm.toFixed(0)} ppm` : "—"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">Manual label</div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={annotation}
                      onChange={(e) => setAnnotation(e.target.value)}
                      placeholder="Label this peak…"
                      className="h-8 text-xs"
                    />
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!annotation.trim() || !selected) return;
                        try {
                          await annotatePeak(run.id, selected.id, annotation);
                          toast.success("Annotated");
                          setAnnotation("");
                        } catch (err: any) {
                          toast.error(err?.message ?? "Failed");
                        }
                      }}
                    >
                      <Sparkles className="mr-1 h-3.5 w-3.5" /> Save
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div className="mt-4 text-xs text-muted-foreground">Select a peak to annotate.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
