import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { HeartPulse, Upload, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createQcRun, deleteQcRun,
} from "@/lib/v3-functions";
import type { QcRun, Column, Batch, CompoundList, Run, Peak } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/qc-health")({
  component: QcHealthPage,
});

function QcHealthPage() {
  const {
    columns, batches, methods, runs, analytes, compoundLists,
    qcRuns, bufferExchangeEvents,
    upsertQcRunLocal, removeQcRunLocal,
  } = useLab();

  const createQcFn = useServerFn(createQcRun);
  const deleteQcFn = useServerFn(deleteQcRun);

  const [columnId, setColumnId] = useState<string>(columns[0]?.id ?? "__none__");
  const [batchId, setBatchId] = useState<string>("__none__");
  const [listId, setListId] = useState<string>("__none__");
  const [analyteFilter, setAnalyteFilter] = useState<string>("__none__");
  const [showUpload, setShowUpload] = useState(false);
  const [busy, setBusy] = useState(false);

  // Upload form state
  const [upName, setUpName] = useState("");
  const [upType, setUpType] = useState<QcRun["qcType"]>("system_suitability");
  const [upRunId, setUpRunId] = useState<string>("__none__");
  const [upAcquiredAt, setUpAcquiredAt] = useState("");

  const selectedColumnId = columnId !== "__none__" ? columnId : null;
  const selectedBatchId = batchId !== "__none__" ? batchId : null;
  const selectedListId = listId !== "__none__" ? listId : null;
  const selectedAnalyteId = analyteFilter !== "__none__" ? analyteFilter : null;

  // Filter QC runs
  const filteredQcRuns = useMemo(() => {
    return qcRuns.filter((q) => {
      if (selectedColumnId && q.columnId !== selectedColumnId) return false;
      if (selectedBatchId && q.batchId !== selectedBatchId) return false;
      return true;
    });
  }, [qcRuns, selectedColumnId, selectedBatchId]);

  // Get the linked runs with trace data for overlay
  const overlayRuns = useMemo(() => {
    const result: Array<{ id: string; name: string; trace: Run["trace"]; peaks?: Peak[] }> = [];
    for (const q of filteredQcRuns) {
      if (!q.runId) continue;
      const run = runs.find((r) => r.id === q.runId);
      if (!run) continue;
      let peaks = run.peaks;
      // Filter by compound list if selected
      if (selectedListId) {
        const list = compoundLists.find((cl) => cl.id === selectedListId);
        if (list) {
          peaks = peaks.filter((p) => p.analyteId && list.analyteIds.includes(p.analyteId));
        }
      }
      // Filter by specific analyte if selected
      if (selectedAnalyteId) {
        peaks = peaks.filter((p) => p.analyteId === selectedAnalyteId);
      }
      result.push({
        id: run.id,
        name: `${q.name} (${new Date(q.acquiredAt).toLocaleDateString()})`,
        trace: run.trace,
        peaks,
      });
    }
    return result.slice(0, 10); // max 10 for overlay
  }, [filteredQcRuns, runs, compoundLists, selectedListId, selectedAnalyteId]);

  // Peak metrics table: for each QC run × analyte, show RT/area/FWHM
  const metricsData = useMemo(() => {
    const rows: Array<{
      qcRunName: string;
      acquiredAt: string;
      analyteName: string;
      rt: number;
      area: number;
      fwhm: number;
      asymmetry: number | undefined;
      sn: number;
    }> = [];
    for (const q of filteredQcRuns) {
      if (!q.runId) continue;
      const run = runs.find((r) => r.id === q.runId);
      if (!run) continue;
      let peaks = run.peaks.filter((p) => p.analyteId);
      if (selectedListId) {
        const list = compoundLists.find((cl) => cl.id === selectedListId);
        if (list) peaks = peaks.filter((p) => p.analyteId && list.analyteIds.includes(p.analyteId));
      }
      if (selectedAnalyteId) peaks = peaks.filter((p) => p.analyteId === selectedAnalyteId);
      for (const p of peaks) {
        const analyte = analytes.find((a) => a.id === p.analyteId);
        rows.push({
          qcRunName: q.name,
          acquiredAt: new Date(q.acquiredAt).toLocaleDateString(),
          analyteName: p.analyteName ?? analyte?.name ?? "Unknown",
          rt: p.rt,
          area: p.area,
          fwhm: p.fwhm,
          asymmetry: p.asymmetry,
          sn: p.sn,
        });
      }
    }
    return rows;
  }, [filteredQcRuns, runs, analytes, compoundLists, selectedListId, selectedAnalyteId]);

  // Compute median values for anomaly highlighting
  const medians = useMemo(() => {
    const byAnalyte = new Map<string, { rts: number[]; areas: number[]; fwhms: number[] }>();
    for (const row of metricsData) {
      const entry = byAnalyte.get(row.analyteName) ?? { rts: [], areas: [], fwhms: [] };
      entry.rts.push(row.rt);
      entry.areas.push(row.area);
      if (row.fwhm > 0) entry.fwhms.push(row.fwhm);
      byAnalyte.set(row.analyteName, entry);
    }
    const result = new Map<string, { rt: number; area: number; fwhm: number }>();
    for (const [name, vals] of byAnalyte) {
      const sorted = (arr: number[]) => [...arr].sort((a, b) => a - b);
      const mid = (arr: number[]) => arr.length === 0 ? 0 : arr[Math.floor(arr.length / 2)];
      result.set(name, {
        rt: mid(sorted(vals.rts)),
        area: mid(sorted(vals.areas)),
        fwhm: mid(sorted(vals.fwhms)),
      });
    }
    return result;
  }, [metricsData]);

  // Buffer events for the selected column (for the trend chart markers)
  const columnBufferEvents = useMemo(() => {
    if (!selectedColumnId) return [];
    return bufferExchangeEvents.filter((e) => e.columnId === selectedColumnId);
  }, [bufferExchangeEvents, selectedColumnId]);

  // Available runs that can be linked to a QC run
  const availableRuns = useMemo(() => {
    if (!selectedColumnId) return runs;
    return runs.filter((r) => r.columnId === selectedColumnId);
  }, [runs, selectedColumnId]);

  // Analytes in the selected compound list (or all if none selected)
  const availableAnalytes = useMemo(() => {
    if (selectedListId) {
      const list = compoundLists.find((cl) => cl.id === selectedListId);
      if (list) return analytes.filter((a) => list.analyteIds.includes(a.id));
    }
    return analytes;
  }, [analytes, compoundLists, selectedListId]);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedColumnId) {
      toast.error("Select a column first");
      return;
    }
    if (!upName.trim()) {
      toast.error("Enter a name for the QC run");
      return;
    }
    if (upRunId === "__none__") {
      toast.error("Select a run to link");
      return;
    }
    setBusy(true);
    try {
      const run = runs.find((r) => r.id === upRunId);
      const res = await createQcFn({
        data: {
          columnId: selectedColumnId,
          batchId: selectedBatchId,
          methodId: run?.methodId ?? null,
          runId: upRunId,
          name: upName,
          qcType: upType,
          acquiredAt: upAcquiredAt || undefined,
        },
      });
      upsertQcRunLocal(res);
      toast.success("QC run created");
      setShowUpload(false);
      setUpName("");
      setUpRunId("__none__");
      setUpAcquiredAt("");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create QC run");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteQcFn({ data: { id } });
      removeQcRunLocal(id);
      toast.success("QC run deleted");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete QC run");
    }
  };

  const cellClass = (value: number, median: number, threshold = 20) => {
    if (median === 0) return "py-1.5 text-xs font-mono";
    const dev = Math.abs(((value - median) / median) * 100);
    if (dev > threshold) return "py-1.5 text-xs font-mono bg-destructive/15 text-destructive";
    return "py-1.5 text-xs font-mono";
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Quality control
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">QC column health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload QC files and overlay chromatograms to track column health over time.
          Select a compound list to narrow the overlay to specific analytes.
        </p>
      </div>

      {/* Filters */}
      <Card className="border-border bg-card p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-[10px] uppercase tracking-widest">Column</Label>
            <Select value={columnId} onValueChange={setColumnId}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All columns</SelectItem>
                {columns.map((c: Column) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest">Batch (optional)</Label>
            <Select value={batchId} onValueChange={setBatchId}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All batches</SelectItem>
                {batches.map((b: Batch) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest">Compound list</Label>
            <Select value={listId} onValueChange={setListId}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All analytes</SelectItem>
                {compoundLists.map((cl: CompoundList) => (
                  <SelectItem key={cl.id} value={cl.id}>{cl.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-widest">Single analyte</Label>
            <Select value={analyteFilter} onValueChange={setAnalyteFilter}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All</SelectItem>
                {availableAnalytes.map((a) => (
                  <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* QC run list + upload */}
      <Card className="border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              QC runs ({filteredQcRuns.length})
            </div>
            <h2 className="text-sm font-semibold">Tracked QC acquisitions</h2>
          </div>
          <Button size="sm" onClick={() => setShowUpload(true)} disabled={!selectedColumnId}>
            <Upload className="mr-1 h-3.5 w-3.5" /> Link QC run
          </Button>
        </div>
        {filteredQcRuns.length === 0 ? (
          <div className="mt-3 text-xs text-muted-foreground">
            No QC runs yet. Select a column and click "Link QC run" to get started.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-[10px] uppercase">Name</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Type</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Column</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Acquired</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Run</TableHead>
                  <TableHead className="h-8 w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQcRuns.map((q: QcRun) => {
                  const col = columns.find((c) => c.id === q.columnId);
                  const run = runs.find((r) => r.id === q.runId);
                  return (
                    <TableRow key={q.id}>
                      <TableCell className="py-1.5 text-xs">{q.name}</TableCell>
                      <TableCell className="py-1.5 text-xs">
                        <Badge variant="outline" className="text-[10px]">{q.qcType.replace(/_/g, " ")}</Badge>
                      </TableCell>
                      <TableCell className="py-1.5 text-xs">{col?.name ?? "—"}</TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{new Date(q.acquiredAt).toLocaleDateString()}</TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{run?.name ?? "—"}</TableCell>
                      <TableCell className="py-1.5">
                        <button onClick={() => handleDelete(q.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Overlay chart */}
      {overlayRuns.length > 0 && (
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Chromatogram overlay
          </div>
          <h2 className="text-sm font-semibold">
            {selectedAnalyteId ? "Single analyte" : selectedListId ? "Compound list" : "All analytes"} — {overlayRuns.length} QC run{overlayRuns.length === 1 ? "" : "s"}
          </h2>
          <div className="mt-3">
            <ChromatogramPlot runs={overlayRuns} height={360} showPeaks={!!selectedAnalyteId} />
          </div>
        </Card>
      )}

      {/* Peak metrics table */}
      {metricsData.length > 0 && (
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Peak metrics
          </div>
          <h2 className="text-sm font-semibold">RT / area / FWHM across QC runs</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Cells highlighted in red deviate more than 20% from the median for that analyte.
          </p>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-[10px] uppercase">QC run</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Date</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Analyte</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">RT (min)</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Area</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">FWHM</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Asym</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">S/N</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metricsData.map((row, i) => {
                  const med = medians.get(row.analyteName);
                  return (
                    <TableRow key={i}>
                      <TableCell className="py-1.5 text-xs">{row.qcRunName}</TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{row.acquiredAt}</TableCell>
                      <TableCell className="py-1.5 text-xs">{row.analyteName}</TableCell>
                      <TableCell className={med ? cellClass(row.rt, med.rt) : "py-1.5 text-xs font-mono"}>
                        {row.rt.toFixed(2)}
                      </TableCell>
                      <TableCell className={med ? cellClass(row.area, med.area) : "py-1.5 text-xs font-mono"}>
                        {row.area.toFixed(0)}
                      </TableCell>
                      <TableCell className={med && med.fwhm > 0 ? cellClass(row.fwhm, med.fwhm) : "py-1.5 text-xs font-mono"}>
                        {row.fwhm > 0 ? row.fwhm.toFixed(3) : "—"}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">
                        {row.asymmetry != null ? row.asymmetry.toFixed(2) : "—"}
                      </TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{row.sn.toFixed(1)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Upload dialog */}
      <Dialog open={showUpload} onOpenChange={(o) => !busy && setShowUpload(o)}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleUpload}>
            <DialogHeader>
              <DialogTitle>Link QC run</DialogTitle>
              <DialogDescription>
                Select an existing parsed run to register it as a QC reference for this column.
                The run's trace and peaks will be used for overlay comparison.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <div>
                <Label htmlFor="qc-name">QC run name</Label>
                <Input id="qc-name" value={upName} onChange={(e) => setUpName(e.target.value)}
                  placeholder="e.g. QC-Std-2026-001" maxLength={200} />
              </div>
              <div>
                <Label htmlFor="qc-type">QC type</Label>
                <Select value={upType} onValueChange={(v) => setUpType(v as QcRun["qcType"])}>
                  <SelectTrigger id="qc-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system_suitability">System suitability</SelectItem>
                    <SelectItem value="column_qc">Column QC</SelectItem>
                    <SelectItem value="batch_qc">Batch QC</SelectItem>
                    <SelectItem value="reference_standard">Reference standard</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="qc-run">Link to run</Label>
                <Select value={upRunId} onValueChange={setUpRunId}>
                  <SelectTrigger id="qc-run"><SelectValue placeholder="Select a parsed run" /></SelectTrigger>
                  <SelectContent>
                    {availableRuns.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name} ({r.peaks.length} peaks)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="qc-acquired">Acquired at (optional)</Label>
                <Input id="qc-acquired" type="datetime-local" value={upAcquiredAt}
                  onChange={(e) => setUpAcquiredAt(e.target.value)} />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="outline" onClick={() => setShowUpload(false)} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Link QC run"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
