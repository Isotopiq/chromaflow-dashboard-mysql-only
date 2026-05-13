import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileWarning, Loader2, Trash2 } from "lucide-react";
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
import { ago } from "@/lib/mock-data";
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
import { createRun, createUploadUrl, deleteRun } from "@/lib/lab.functions";
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
  const workerRef = useRef<Worker | null>(null);
  const nav = useNavigate();
  const qc = useQueryClient();

  const createRunFn = useServerFn(createRun);
  const createUploadUrlFn = useServerFn(createUploadUrl);

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

      const saved = await createRunFn({
        data: {
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
          trace: parsed.summary.trace,
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
        },
      });

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
        <div className="border-b border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Parsed runs
          </div>
          <h2 className="text-sm font-semibold">{runs.length} runs</h2>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase tracking-wider">File</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Method</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Mode</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Peaks</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Size</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Acquired</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => {
              const m = methods.find((x) => x.id === r.methodId);
              return (
                <TableRow key={r.id} className="text-xs">
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
