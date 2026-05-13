import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Sparkles, Download } from "lucide-react";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { PeakTable } from "@/components/peak-table";
import { ago } from "@/lib/mock-data";
import { toast } from "sonner";

export const Route = createFileRoute("/_shell/runs/$runId")({
  component: RunDetail,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Run not found.</div>
  ),
});

function RunDetail() {
  const { runId } = Route.useParams();
  const { runs, methods, columns, analytes, annotatePeak } = useLab();
  const run = runs.find((r) => r.id === runId);
  if (!run) throw notFound();
  const method = methods.find((m) => m.id === run.methodId);
  const column = columns.find((c) => c.id === run.columnId);
  const [selectedId, setSelected] = useState<string | undefined>(run.peaks[0]?.id);
  const [annotation, setAnnotation] = useState("");

  const selected = run.peaks.find((p) => p.id === selectedId);
  const suggested = analytes
    .map((a) => ({ a, dist: Math.abs(a.rtExpected - (selected?.rt ?? 0)) }))
    .sort((x, y) => x.dist - y.dist)
    .slice(0, 3);

  const downloadCsv = () => {
    const header = "rt,area,height,fwhm,sn,mz,annotation\n";
    const body = run.peaks
      .map(
        (p) =>
          `${p.rt},${p.area},${p.height},${p.fwhm},${p.sn},${p.mz ?? ""},${p.analyteName ?? ""}`,
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

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            to="/runs"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> All runs
          </Link>
          <h1 className="mt-1 font-mono text-xl font-semibold tracking-tight">{run.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{method?.name}</span>·<span>{column?.name}</span>·
            <Badge variant="outline" className="text-[10px]">
              {run.ionMode === "positive" ? "ESI +" : "ESI −"}
            </Badge>
            <span>·</span>
            <span>{run.fileSize}</span>·<span>{ago(run.acquiredAt)}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadCsv}>
            <Download className="mr-1 h-3.5 w-3.5" /> Peak table CSV
          </Button>
        </div>
      </div>

      <Card className="border-border bg-card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            TIC chromatogram
          </div>
          <div className="text-[10px] text-muted-foreground">
            {run.peaks.length} peaks ·{" "}
            <span className="text-[color:var(--peak-annotated)]">
              {run.peaks.filter((p) => p.analyteName).length} annotated
            </span>
          </div>
        </div>
        <ChromatogramPlot runs={[run]} height={300} showPeaks />
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card p-0 lg:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Peak table
            </div>
            <h2 className="text-sm font-semibold">Detected peaks</h2>
          </div>
          <div className="p-3">
            <PeakTable peaks={run.peaks} selectedId={selectedId} onSelect={(p) => setSelected(p.id)} />
          </div>
        </Card>

        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Annotation
          </div>
          {selected ? (
            <>
              <div className="mt-2 font-mono text-xs">
                <div>RT {selected.rt.toFixed(2)} min</div>
                <div className="text-muted-foreground">m/z {selected.mz?.toFixed(4) ?? "—"}</div>
              </div>

              <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
                Suggested matches
              </div>
              <div className="mt-2 space-y-1">
                {suggested.map(({ a, dist }) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      annotatePeak(run.id, selected.id, a.name);
                      toast.success(`Annotated as ${a.name}`);
                    }}
                    className="flex w-full items-center justify-between rounded-md border border-border bg-surface-elevated px-2 py-1.5 text-left text-xs hover:border-primary/60"
                  >
                    <div>
                      <div className="font-medium">{a.name}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {a.formula} · {a.mz.toFixed(4)}
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      ΔRT {dist.toFixed(2)}
                    </Badge>
                  </button>
                ))}
              </div>

              <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
                Manual label
              </div>
              <div className="mt-2 flex gap-2">
                <Input
                  value={annotation}
                  onChange={(e) => setAnnotation(e.target.value)}
                  placeholder="Label this peak…"
                  className="h-8 text-xs"
                />
                <Button
                  size="sm"
                  onClick={() => {
                    if (!annotation.trim()) return;
                    annotatePeak(run.id, selected.id, annotation);
                    toast.success("Annotated");
                    setAnnotation("");
                  }}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" /> Save
                </Button>
              </div>
            </>
          ) : (
            <div className="mt-4 text-xs text-muted-foreground">Select a peak to annotate.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
