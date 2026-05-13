import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useLab, useAnnotatePeak } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Sparkles, Download, Activity } from "lucide-react";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { PeakTable } from "@/components/peak-table";
import { ago } from "@/lib/mock-data";
import { toast } from "sonner";
import { getRunEIC } from "@/lib/lab.functions";

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
  const run = runs.find((r) => r.id === runId);
  if (!run) throw notFound();
  const method = methods.find((m) => m.id === run.methodId);
  const column = columns.find((c) => c.id === run.columnId);
  const [selectedId, setSelected] = useState<string | undefined>(run.peaks[0]?.id);
  const [annotation, setAnnotation] = useState("");
  const [ppm, setPpm] = useState(10);
  const [customMz, setCustomMz] = useState("");

  const selected = run.peaks.find((p) => p.id === selectedId);
  // Custom m/z (when typed and valid) ALWAYS overrides the selected peak.
  // parseFloat("") and parseFloat("abc") return NaN — we filter those out.
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

  const eicTrace = useMemo(() => {
    if (!eicQuery.data) return null;
    return {
      id: `eic-${eicMz}`,
      name: `EIC m/z ${eicMz?.toFixed(4)} ±${ppm} ppm`,
      trace: { x: eicQuery.data.x, tic: eicQuery.data.y, bpc: eicQuery.data.y },
    };
  }, [eicQuery.data, eicMz, ppm]);

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
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Extracted ion chromatogram (EIC)
            </div>
            <div className="mt-0.5 font-mono text-xs">
              {eicMz != null ? (
                <>m/z {eicMz.toFixed(4)} · ±{ppm} ppm
                  {eicQuery.data && (
                    <span className="text-muted-foreground"> · window [{eicQuery.data.mzLow.toFixed(4)} – {eicQuery.data.mzHigh.toFixed(4)}]</span>
                  )}
                </>
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
            Select a peak from the table below to extract its ion chromatogram.
          </div>
        ) : eicQuery.isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">Extracting EIC…</div>
        ) : eicTrace ? (
          <ChromatogramPlot runs={[eicTrace]} height={220} channel="tic" />
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card p-0 lg:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Peak table</div>
            <h2 className="text-sm font-semibold">Detected peaks — click any row to extract its EIC</h2>
          </div>
          <div className="p-3">
            <PeakTable peaks={run.peaks} selectedId={selectedId} onSelect={(p) => setSelected(p.id)} />
          </div>
        </Card>

        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Annotation</div>
          {selected ? (
            <>
              <div className="mt-2 font-mono text-xs">
                <div>RT {selected.rt.toFixed(2)} min</div>
                <div className="text-muted-foreground">m/z {selected.mz?.toFixed(4) ?? "—"}</div>
                {selected.mzLow != null && (
                  <div className="text-muted-foreground">±10 ppm: [{selected.mzLow.toFixed(4)}, {selected.mzHigh?.toFixed(4)}]</div>
                )}
              </div>

              <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
                Suggested matches (RT + m/z)
              </div>
              <div className="mt-2 space-y-1">
                {suggested.map(({ a, dRt, dPpm }) => (
                  <button
                    key={a.id}
                    onClick={async () => {
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
                    if (!annotation.trim()) return;
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
          ) : (
            <div className="mt-4 text-xs text-muted-foreground">Select a peak to annotate.</div>
          )}
        </Card>
      </div>
    </div>
  );
}
