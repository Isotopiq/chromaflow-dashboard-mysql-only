import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { StatusDot } from "@/components/status-dot";
import { SaveStatus, type SaveState } from "@/components/save-status";
import { ArrowLeft, Download, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  upsertBatch,
  updateBatchNotes,
  setRunBatch,
  autoAnnotateBatch,
} from "@/lib/lab.functions";
import type { Batch, Run } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/batches/$batchId")({
  component: BatchDetailGate,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Batch not found.</div>
  ),
});

function BatchDetailGate() {
  const { batchId } = Route.useParams();
  const { batches, hydrated } = useLab();
  const batch = batches.find((b) => b.id === batchId);
  if (!batch) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Link
          to="/batches"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All batches
        </Link>
        <Card className="border-border bg-card p-6">
          <div className="text-sm font-medium">
            {hydrated ? "Batch not found" : "Loading batch…"}
          </div>
        </Card>
      </div>
    );
  }
  return <BatchDetail batch={batch} />;
}

function BatchDetail({ batch }: { batch: Batch }) {
  const { runs, methods, columns, users } = useLab();
  const upsertBatchLocal = useLab((s) => s.upsertBatchLocal);
  const updateBatchNotesLocal = useLab((s) => s.updateBatchNotesLocal);
  const setRunBatchLocal = useLab((s) => s.setRunBatchLocal);
  const upsertBatchFn = useServerFn(upsertBatch);
  const updateBatchNotesFn = useServerFn(updateBatchNotes);
  const setRunBatchFn = useServerFn(setRunBatch);
  const autoAnnotateFn = useServerFn(autoAnnotateBatch);
  const qc = useQueryClient();

  const batchRuns = useMemo(
    () => runs.filter((r) => r.batchId === batch.id),
    [runs, batch.id],
  );
  const unassignedRuns = useMemo(
    () => runs.filter((r) => !r.batchId),
    [runs],
  );

  const totalPeaks = batchRuns.reduce((s, r) => s + r.peaks.length, 0);
  const annotatedPeaks = batchRuns.reduce(
    (s, r) => s + r.peaks.filter((p) => p.analyteId || p.analyteName).length,
    0,
  );
  const methodIds = new Set(batchRuns.map((r) => r.methodId).filter(Boolean));
  const columnIds = new Set(batchRuns.map((r) => r.columnId).filter(Boolean));
  const owner = users.find((u) => u.id === batch.owner);

  // ---- Header field autosave (name / project / status) ----
  const [name, setName] = useState(batch.name);
  const [project, setProject] = useState(batch.project);
  const [status, setStatus] = useState<Batch["status"]>(batch.status);
  const [headerState, setHeaderState] = useState<SaveState>("idle");
  const [headerSavedAt, setHeaderSavedAt] = useState<number | null>(null);
  const headerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerSig = `${name}|${project}|${status}`;
  const initialHeader = useRef(`${batch.name}|${batch.project}|${batch.status}`);

  useEffect(() => {
    if (headerSig === initialHeader.current) return;
    if (headerTimer.current) clearTimeout(headerTimer.current);
    setHeaderState("saving");
    headerTimer.current = setTimeout(async () => {
      try {
        const saved = await upsertBatchFn({
          data: { id: batch.id, name, project, status },
        });
        upsertBatchLocal(saved);
        initialHeader.current = `${saved.name}|${saved.project}|${saved.status}`;
        setHeaderState("saved");
        setHeaderSavedAt(Date.now());
      } catch (e: any) {
        setHeaderState("error");
        toast.error(e?.message ?? "Failed to save batch");
      }
    }, 600);
    return () => {
      if (headerTimer.current) clearTimeout(headerTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headerSig]);

  // ---- Notes autosave ----
  const [notes, setNotes] = useState(batch.notes ?? "");
  const [notesState, setNotesState] = useState<SaveState>("idle");
  const [notesSavedAt, setNotesSavedAt] = useState<number | null>(null);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialNotes = useRef(batch.notes ?? "");

  useEffect(() => {
    if (notes === initialNotes.current) return;
    if (notesTimer.current) clearTimeout(notesTimer.current);
    setNotesState("saving");
    notesTimer.current = setTimeout(async () => {
      try {
        await updateBatchNotesFn({ data: { batchId: batch.id, notes } });
        updateBatchNotesLocal(batch.id, notes);
        initialNotes.current = notes;
        setNotesState("saved");
        setNotesSavedAt(Date.now());
      } catch (e: any) {
        setNotesState("error");
        toast.error(e?.message ?? "Failed to save notes");
      }
    }, 600);
    return () => {
      if (notesTimer.current) clearTimeout(notesTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  // ---- Auto-annotate ----
  const [ppmTol, setPpmTol] = useState(10);
  const [rtTolMin, setRtTolMin] = useState(0.3);
  const [annotating, setAnnotating] = useState(false);

  async function runAutoAnnotate() {
    setAnnotating(true);
    try {
      const res = await autoAnnotateFn({
        data: { batchId: batch.id, ppmTol, rtTolMin },
      });
      toast.success(
        `Annotated ${res.annotated} of ${res.scanned} peaks. Refreshing…`,
      );
      qc.invalidateQueries({ queryKey: ["lab"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Auto-annotate failed");
    } finally {
      setAnnotating(false);
    }
  }

  // ---- Add / remove runs ----
  const [addOpen, setAddOpen] = useState(false);
  async function attachRun(runId: string) {
    try {
      await setRunBatchFn({ data: { runId, batchId: batch.id } });
      setRunBatchLocal(runId, batch.id);
      setAddOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add run");
    }
  }
  async function detachRun(runId: string) {
    try {
      await setRunBatchFn({ data: { runId, batchId: null } });
      setRunBatchLocal(runId, null);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to remove run");
    }
  }

  // ---- Export ----
  function exportCsv() {
    const rows: string[] = [
      "run,peak_id,rt,area,height,fwhm,sn,mz,analyte,confidence,manual",
    ];
    for (const r of batchRuns) {
      for (const p of r.peaks) {
        rows.push(
          [
            csv(r.name),
            csv(p.id),
            p.rt.toFixed(4),
            p.area.toFixed(2),
            p.height.toFixed(2),
            p.fwhm.toFixed(4),
            p.sn.toFixed(2),
            p.mz != null ? p.mz.toFixed(4) : "",
            csv(p.analyteName ?? ""),
            p.confidence != null ? p.confidence.toFixed(3) : "",
            p.manual ? "1" : "0",
          ].join(","),
        );
      }
    }
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${batch.name.replace(/\s+/g, "_")}_peaks.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to="/batches"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> All batches
          </Link>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-auto border-none bg-transparent p-0 text-2xl font-semibold tracking-tight shadow-none focus-visible:ring-0"
          />
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <Input
              value={project}
              placeholder="Project"
              onChange={(e) => setProject(e.target.value)}
              className="h-6 w-44 border-none bg-transparent p-0 text-xs shadow-none focus-visible:ring-0"
            />
            <span>·</span>
            <span className="flex items-center gap-1.5">
              <StatusDot status={status} />
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as Batch["status"])}
              >
                <SelectTrigger className="h-6 w-32 border-none bg-transparent p-0 text-xs capitalize shadow-none focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="review">Review</SelectItem>
                  <SelectItem value="complete">Complete</SelectItem>
                </SelectContent>
              </Select>
            </span>
            <span>·</span>
            <span className="font-mono">{owner?.name ?? "—"}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <SaveStatus state={headerState} lastSavedAt={headerSavedAt} />
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export peaks CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Runs" value={String(batchRuns.length)} />
        <Stat label="Peaks" value={String(totalPeaks)} />
        <Stat
          label="Annotated"
          value={`${annotatedPeaks}${totalPeaks ? ` (${Math.round((annotatedPeaks / totalPeaks) * 100)}%)` : ""}`}
        />
        <Stat label="Methods" value={String(methodIds.size)} />
        <Stat label="Columns" value={String(columnIds.size)} />
      </div>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">Runs in batch</div>
          <Popover open={addOpen} onOpenChange={setAddOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add runs…
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="end">
              <div className="max-h-72 overflow-y-auto p-1">
                {unassignedRuns.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">
                    No unassigned runs available.
                  </div>
                )}
                {unassignedRuns.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => attachRun(r.id)}
                    className="block w-full truncate rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  >
                    {r.name}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {batchRuns.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No runs in this batch yet. Add some above.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Column</TableHead>
                <TableHead className="text-right">Peaks</TableHead>
                <TableHead className="text-right">Annotated</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {batchRuns.map((r) => (
                <RunRow
                  key={r.id}
                  run={r}
                  methodName={methods.find((m) => m.id === r.methodId)?.name}
                  columnName={columns.find((c) => c.id === r.columnId)?.name}
                  onRemove={() => detachRun(r.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">Auto-annotate batch</div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ppm">m/z tolerance (ppm)</Label>
            <Input
              id="ppm"
              type="number"
              min={0}
              max={200}
              step={1}
              value={ppmTol}
              onChange={(e) => setPpmTol(Number(e.target.value))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="rt">RT tolerance (min)</Label>
            <Input
              id="rt"
              type="number"
              min={0}
              max={5}
              step={0.05}
              value={rtTolMin}
              onChange={(e) => setRtTolMin(Number(e.target.value))}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={runAutoAnnotate}
              disabled={annotating || batchRuns.length === 0}
              className="w-full"
            >
              {annotating ? "Annotating…" : "Auto-annotate all peaks"}
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Matches every peak in this batch against your compound library and saves
          annotations server-side.
        </p>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <Label htmlFor="batch-notes" className="text-sm font-medium">
            Batch notes
          </Label>
          <SaveStatus state={notesState} lastSavedAt={notesSavedAt} />
        </div>
        <Textarea
          id="batch-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={6}
          placeholder="Observations, sample prep notes, reviewer comments… Autosaved as you type."
        />
      </Card>
    </div>
  );
}

function RunRow({
  run,
  methodName,
  columnName,
  onRemove,
}: {
  run: Run;
  methodName?: string;
  columnName?: string;
  onRemove: () => void;
}) {
  const annotated = run.peaks.filter((p) => p.analyteId || p.analyteName).length;
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <Link
          to="/runs/$runId"
          params={{ runId: run.id }}
          className="hover:underline"
        >
          {run.name}
        </Link>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {methodName ?? "—"}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {columnName ?? "—"}
      </TableCell>
      <TableCell className="text-right font-mono text-xs">
        {run.peaks.length}
      </TableCell>
      <TableCell className="text-right">
        <Badge variant="outline" className="text-[10px]">
          {annotated}/{run.peaks.length}
        </Badge>
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          aria-label={`Remove ${run.name} from batch`}
          onClick={onRemove}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-3">
      <div className="font-mono text-base">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function csv(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
