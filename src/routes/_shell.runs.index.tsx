import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, FileWarning } from "lucide-react";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { ago } from "@/lib/mock-data";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

export const Route = createFileRoute("/_shell/runs/")({
  component: RunsList,
});

function RunsList() {
  const { runs, methods } = useLab();
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const names = Array.from(files).map((f) => f.name);
    const unsupported = names.find((n) => /\.(raw|wiff|d)$/i.test(n));
    if (unsupported) {
      toast.warning(
        `${unsupported} is a vendor binary format. Convert to mzML with msconvert (ProteoWizard) for chromatogram extraction.`,
      );
    }
    const supported = names.filter((n) => /\.mz(ML|XML)$/i.test(n));
    if (supported.length > 0) {
      toast.success(
        `Queued ${supported.length} file(s) for parsing. (Worker-based mzML parser ships in phase 2.)`,
      );
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
          Drop mzML files here. Parsed runs appear below — click to view chromatograms and peaks.
        </p>
      </div>

      <Card
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
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
          Files are parsed in the browser via Web Worker. Vendor formats (.raw, .wiff, .d) need
          conversion via{" "}
          <a
            href="https://proteowizard.sourceforge.io/"
            target="_blank"
            rel="noreferrer"
            className="text-primary underline"
          >
            ProteoWizard msconvert
          </a>{" "}
          first.
        </p>
        <label className="mt-2 inline-flex">
          <input
            type="file"
            multiple
            accept=".mzML,.mzXML,.raw,.wiff,.d"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <span className="cursor-pointer rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent">
            Choose files
          </span>
        </label>
      </Card>

      <div className="flex items-start gap-2 rounded-md border border-[color:var(--status-warn)]/40 bg-[color:var(--status-warn)]/5 p-3 text-[11px]">
        <FileWarning className="mt-0.5 h-3.5 w-3.5 text-[color:var(--status-warn)]" />
        <div className="text-muted-foreground">
          Phase 1 demo data. Real client-side mzML parsing (pako + fast-xml-parser in a Web Worker)
          is wired in phase 2 once Lovable Cloud or your Supabase is connected.
        </div>
      </div>

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

      <Card className="border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Latest acquisition
            </div>
            <h2 className="text-sm font-semibold">{runs[0]?.name}</h2>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/runs/$runId" params={{ runId: runs[0]?.id ?? "" }}>
              Open viewer
            </Link>
          </Button>
        </div>
        <ChromatogramPlot runs={[runs[0]]} height={220} showPeaks />
      </Card>
    </div>
  );
}
