import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileWarning, Loader2, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ago } from "@/lib/time";
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
import { toast } from "sonner";
import { createRun, createUploadUrl, deleteRun, findRunByFilePath } from "@/lib/lab.functions";
import { getSupabase } from "@/integrations/supabase/client";
import type { WorkerRunSummary } from "@/workers/mzml.worker";

export const Route = createFileRoute("/_shell/runs/")({
  component: RunsList,
});

type ParseJob = {
  id: string;
  filename: string;
  status: "parsing" | "uploading" | "saving" | "done" | "error";
  message?: string;
};

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(1)} MB`;
}

function RunsList() {
  const { runs, methods, columns } = useLab();
  const upsertRunLocal = useLab((s) => s.upsertRunLocal);
  const removeRunLocal = useLab((s) => s.removeRunLocal);
  const deleteRunFn = useServerFn(deleteRun);
  const [dragOver, setDragOver] = useState(false);
  const [methodId, setMethodId] = useState<string>("");
  const [columnId, setColumnId] = useState<string>("");
  const [jobs, setJobs] = useState<ParseJob[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const nav = useNavigate();
  const qc = useQueryClient();

  const createRunFn = useServerFn(createRun);
  const createUploadUrlFn = useServerFn(createUploadUrl);
  const findRunByPathFn = useServerFn(findRunByFilePath);

  // Largest Triangle Three Buckets downsample — keeps the visual shape of a
  // chromatogram while drastically cutting payload size. Returns a parallel
  // (x, y) pair of length <= maxPoints.
  function lttb(x: number[], y: number[], maxPoints: number): { x: number[]; y: number[] } {
    const n = x.length;
    if (n <= maxPoints || maxPoints < 3) return { x: x.slice(), y: y.slice() };
    const outX = new Array<number>(maxPoints);
    const outY = new Array<number>(maxPoints);
    outX[0] = x[0];
    outY[0] = y[0];
    let a = 0;
    const bucketSize = (n - 2) / (maxPoints - 2);
    for (let i = 0; i < maxPoints - 2; i++) {
      const start = Math.floor((i + 1) * bucketSize) + 1;
      const end = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);
      let avgX = 0;
      let avgY = 0;
      const range = Math.max(1, end - start);
      for (let k = start; k < end; k++) {
        avgX += x[k];
        avgY += y[k];
      }
      avgX /= range;
      avgY /= range;
      const rangeStart = Math.floor(i * bucketSize) + 1;
      const rangeEnd = Math.floor((i + 1) * bucketSize) + 1;
      let maxArea = -1;
      let next = rangeStart;
      const ax = x[a];
      const ay = y[a];
      for (let k = rangeStart; k < rangeEnd; k++) {
        const area = Math.abs((ax - avgX) * (y[k] - ay) - (ax - x[k]) * (avgY - ay));
        if (area > maxArea) {
          maxArea = area;
          next = k;
        }
      }
      outX[i + 1] = x[next];
      outY[i + 1] = y[next];
      a = next;
    }
    outX[maxPoints - 1] = x[n - 1];
    outY[maxPoints - 1] = y[n - 1];
    return { x: outX, y: outY };
  }

  function decimateTrace(t: { x: number[]; tic: number[]; bpc: number[] }, maxPoints = 2500) {
    if (t.x.length <= maxPoints) return t;
    // Decimate TIC and BPC against the same x (drive sampling from TIC).
    const tic = lttb(t.x, t.tic, maxPoints);
    // Re-sample BPC at the chosen x indices using a parallel pass.
    const bpc = lttb(t.x, t.bpc, maxPoints);
    return { x: tic.x, tic: tic.y, bpc: bpc.y };
  }

  function isNetworkError(err: any): boolean {
    const msg = String(err?.message ?? err ?? "");
    return (
      err instanceof TypeError ||
      /failed to fetch|networkerror|load failed|aborted|err_network/i.test(msg)
    );
  }

  useEffect(() => {
    workerRef.current = new Worker(
      new URL("../workers/mzml.worker.ts", import.meta.url),
      { type: "module" },
    );
    return () => workerRef.current?.terminate();
  }, []);

  useEffect(() => {
    if (!methodId && methods[0]) setMethodId(methods[0].id);
    if (!columnId && columns[0]) setColumnId(columns[0].id);
  }, [methods, columns, methodId, columnId]);

  const updateJob = (id: string, patch: Partial<ParseJob>) =>
    setJobs((xs) => xs.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  async function processFile(file: File) {
    const id = crypto.randomUUID();
    const job: ParseJob = { id, filename: file.name, status: "parsing" };
    setJobs((xs) => [job, ...xs]);

    try {
      const text = await file.text();
      const parsed = await new Promise<{ summary: WorkerRunSummary; scansBlob: Uint8Array }>(
        (resolve, reject) => {
          const w = workerRef.current!;
          const handler = (e: MessageEvent) => {
            if (e.data?.id !== id) return;
            w.removeEventListener("message", handler);
            if (e.data.ok) resolve({ summary: e.data.summary, scansBlob: e.data.scansBlob });
            else reject(new Error(e.data.error || "Parse failed"));
          };
          w.addEventListener("message", handler);
          w.postMessage({ id, text });
        },
      );

      updateJob(id, { status: "uploading" });

      const sb = await getSupabase();
      const [rawUrl, scansUrl] = await Promise.all([
        createUploadUrlFn({ data: { filename: file.name, bucket: "raw-runs" } }),
        createUploadUrlFn({
          data: { filename: file.name, bucket: "raw-runs", suffix: ".scans.bin" },
        }),
      ]);

      const upRaw = await sb.storage
        .from("raw-runs")
        .uploadToSignedUrl(rawUrl.path, rawUrl.token, file);
      if (upRaw.error) throw upRaw.error;

      const blobFile = new Blob([parsed.scansBlob as BlobPart], { type: "application/octet-stream" });
      const upScans = await sb.storage
        .from("raw-runs")
        .uploadToSignedUrl(scansUrl.path, scansUrl.token, blobFile);
      if (upScans.error) throw upScans.error;

      updateJob(id, { status: "saving" });

      const slimTrace = decimateTrace(parsed.summary.trace, 2500);
      const runPayload = {
        name: file.name,
        methodId: methodId || null,
        columnId: columnId || null,
        batchId: null,
        filePath: rawUrl.path,
        scansBlobPath: scansUrl.path,
        fileFormat: parsed.summary.format,
        fileSize: fmtBytes(file.size),
        ionMode: parsed.summary.ionMode,
        msLevel: 1,
        trace: slimTrace,
        peaks: parsed.summary.peaks.map((p) => ({
          rt: p.rt,
          area: p.area,
          height: p.height,
          fwhm: p.fwhm,
          sn: p.sn,
          mz: p.mz,
          mzLow: p.mzLow,
          mzHigh: p.mzHigh,
        })),
      };

      // Save with one retry. If both attempts hit a network-style error
      // (TypeError / "Failed to fetch"), poll the server to see if the
      // insert already committed — the response just never made it back.
      let saved: any = null;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          saved = await createRunFn({ data: runPayload });
          lastErr = null;
          break;
        } catch (e: any) {
          lastErr = e;
          if (!isNetworkError(e)) throw e;
          updateJob(id, {
            status: "saving",
            message: "Network dropped — checking server…",
          });
          await new Promise((r) => setTimeout(r, 800 + attempt * 800));
        }
      }
      if (!saved && lastErr) {
        // Network failed both times — see if it actually landed server-side.
        try {
          const found = await findRunByPathFn({ data: { filePath: rawUrl.path } });
          if (found.run) saved = found.run;
        } catch {
          /* swallow — fall through to the original error below */
        }
      }
      if (!saved) throw lastErr ?? new Error("Failed to save run");

      // Push the freshly-saved run into the local store BEFORE navigating
      // so the run-detail route can find it. Without this the route loads,
      // can't find the run in the store, and renders "Run not found" until
      // the user reloads (which triggers loadAll re-hydration).
      upsertRunLocal(saved as any);
      updateJob(id, { status: "done" });
      toast.success(`${file.name} parsed: ${parsed.summary.peaks.length} peaks${parsed.summary.truncated ? " (scans truncated)" : ""}`);
      qc.invalidateQueries({ queryKey: ["lab"] });
      nav({ to: "/runs/$runId", params: { runId: (saved as any).id } });
    } catch (err: any) {
      console.error(err);
      updateJob(id, { status: "error", message: err?.message ?? String(err) });
      toast.error(`${file.name}: ${err?.message ?? "Failed"}`);
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const f of Array.from(files)) {
      if (/\.(raw|wiff|d)$/i.test(f.name)) {
        toast.warning(
          `${f.name} is a vendor binary format. Convert to mzML with msconvert (ProteoWizard) first.`,
        );
        continue;
      }
      if (!/\.mz(ML|XML)$/i.test(f.name)) {
        toast.error(`${f.name}: unsupported format`);
        continue;
      }
      processFile(f);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Acquisition
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Runs & uploads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop mzML / mzXML files. Parsed in your browser, peaks &amp; per-scan EIC data
          persisted to your Supabase. Click any peak in a run to see its extracted ion
          chromatogram.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Method</label>
          <Select value={methodId} onValueChange={setMethodId}>
            <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue placeholder="Select method" /></SelectTrigger>
            <SelectContent>
              {methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-widest text-muted-foreground">Column</label>
          <Select value={columnId} onValueChange={setColumnId}>
            <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue placeholder="Select column" /></SelectTrigger>
            <SelectContent>
              {columns.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed bg-card/50 p-10 transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border"
        }`}
      >
        <Upload className="h-6 w-6 text-muted-foreground" />
        <div className="text-sm font-medium">Drop mzML / mzXML files</div>
        <p className="max-w-md text-center text-xs text-muted-foreground">
          Files are parsed in the browser via Web Worker. Vendor formats (.raw, .wiff, .d)
          need conversion with{" "}
          <a href="https://proteowizard.sourceforge.io/" target="_blank" rel="noreferrer" className="text-primary underline">
            ProteoWizard msconvert
          </a>{" "}
          first.
        </p>
        <label className="mt-2 inline-flex">
          <input
            type="file"
            multiple
            accept=".mzML,.mzXML"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <span className="cursor-pointer rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent">
            Choose files
          </span>
        </label>
      </Card>

      {jobs.length > 0 && (
        <Card className="border-border bg-card p-0">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">In flight</div>
            <h2 className="text-sm font-semibold">{jobs.length} parse job(s)</h2>
          </div>
          <ul className="divide-y divide-border">
            {jobs.map((j) => (
              <li key={j.id} className="flex items-center justify-between px-4 py-2 text-xs">
                <div className="font-mono">{j.filename}</div>
                <div className="flex items-center gap-2">
                  {j.status !== "done" && j.status !== "error" && (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  )}
                  <Badge variant="outline" className="text-[10px]">{j.status}</Badge>
                  {j.message && <span className="text-[color:var(--status-error)]">{j.message}</span>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {runs.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-[color:var(--status-warn)]/40 bg-[color:var(--status-warn)]/5 p-3 text-[11px]">
          <FileWarning className="mt-0.5 h-3.5 w-3.5 text-[color:var(--status-warn)]" />
          <div className="text-muted-foreground">
            No runs yet. Drop an mzML file above to extract chromatograms, peaks and per-peak EIC traces.
          </div>
        </div>
      )}

      <Card className="border-border bg-card p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Parsed runs
            </div>
            <h2 className="text-sm font-semibold">
              {runs.length} runs{selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
            </h2>
          </div>
          {selectedIds.size > 0 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive" disabled={bulkDeleting} className="h-8">
                  {bulkDeleting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Delete {selectedIds.size}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {selectedIds.size} run(s)?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes the selected runs, their peaks, and any uploaded raw / scan files. This can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      setBulkDeleting(true);
                      const ids = Array.from(selectedIds);
                      let ok = 0;
                      let fail = 0;
                      for (const id of ids) {
                        try {
                          await deleteRunFn({ data: { runId: id } });
                          removeRunLocal(id);
                          ok++;
                        } catch {
                          fail++;
                        }
                      }
                      setSelectedIds(new Set());
                      setBulkDeleting(false);
                      qc.invalidateQueries({ queryKey: ["lab"] });
                      if (ok) toast.success(`Deleted ${ok} run(s)`);
                      if (fail) toast.error(`Failed to delete ${fail} run(s)`);
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="w-10">
                <Checkbox
                  checked={runs.length > 0 && selectedIds.size === runs.length}
                  onCheckedChange={(v) => {
                    if (v) setSelectedIds(new Set(runs.map((r) => r.id)));
                    else setSelectedIds(new Set());
                  }}
                  aria-label="Select all runs"
                />
              </TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">File</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Method</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Mode</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Peaks</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Size</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Acquired</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => {
              const m = methods.find((x) => x.id === r.methodId);
              return (
                <TableRow key={r.id} className="text-xs" data-state={selectedIds.has(r.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={(v) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          if (v) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        });
                      }}
                      aria-label={`Select ${r.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/runs/$runId"
                      params={{ runId: r.id }}
                      className="font-mono font-medium hover:text-primary"
                    >
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{m?.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {r.ionMode === "positive" ? "ESI +" : "ESI −"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono">{r.peaks.length}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">{r.fileSize}</TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {ago(r.acquiredAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${r.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete run?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently removes <span className="font-mono">{r.name}</span>,
                            its peaks, and any uploaded raw / scan files. This can't be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={async () => {
                              try {
                                await deleteRunFn({ data: { runId: r.id } });
                                removeRunLocal(r.id);
                                qc.invalidateQueries({ queryKey: ["lab"] });
                                toast.success(`Deleted ${r.name}`);
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
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {runs[0] && (
        <Card className="border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Latest acquisition
              </div>
              <h2 className="text-sm font-semibold">{runs[0]?.name}</h2>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/runs/$runId" params={{ runId: runs[0].id }}>Open viewer</Link>
            </Button>
          </div>
          <ChromatogramPlot runs={[runs[0]]} height={220} showPeaks />
        </Card>
      )}
    </div>
  );
}
