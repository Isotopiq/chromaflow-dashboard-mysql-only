import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { ago } from "@/lib/time";
import { Layers, Columns2, Download } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_shell/overlay")({
  component: Overlay,
});

function Overlay() {
  const { runs, methods } = useLab();
  const [selected, setSelected] = useState<string[]>(runs.slice(0, 3).map((r) => r.id));
  const [channel, setChannel] = useState<"tic" | "bpc">("tic");
  const [viewMode, setViewMode] = useState<"stacked" | "single">("single");
  const [useAlignedRt, setUseAlignedRt] = useState(false);

  const overlayRuns = useMemo(() => {
    return selected
      .map((id) => runs.find((r) => r.id === id))
      .filter((r): r is (typeof runs)[number] => Boolean(r))
      .map((r) => {
        if (useAlignedRt && r.peaks.some((p) => p.alignedRt != null)) {
          // If aligned RT exists, shift the trace X-axis by the average alignment shift
          const shifts = r.peaks
            .filter((p) => p.alignedRt != null)
            .map((p) => p.alignedRt! - p.rt);
          const avgShift = shifts.length > 0 ? shifts.reduce((a, b) => a + b, 0) / shifts.length : 0;
          return {
            ...r,
            trace: {
              ...r.trace,
              x: r.trace.x.map((t) => t + avgShift),
            },
          };
        }
        return r;
      });
  }, [selected, runs, useAlignedRt]);

  const hasAligned = runs.some((r) => r.peaks.some((p) => p.alignedRt != null));

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Acquisition
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overlay workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick runs to overlay. Compare retention drift, peak shape and intensity across acquisitions.
          Stacked mode shows each run in its own panel with a shared X-axis range.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Runs ({selected.length} selected, max 10)
          </div>
          <div className="mt-2 max-h-[480px] space-y-1 overflow-y-auto pr-1">
            {runs.map((r) => {
              const checked = selected.includes(r.id);
              const method = methods.find((m) => m.id === r.methodId);
              const hasAlign = r.peaks.some((p) => p.alignedRt != null);
              return (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs hover:bg-accent/30"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) =>
                      setSelected(
                        v
                          ? selected.length < 10
                            ? [...selected, r.id]
                            : (toast.error("Max 10 runs in overlay"), selected)
                          : selected.filter((x) => x !== r.id),
                      )
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {method?.name} · {ago(r.acquiredAt)}
                    </div>
                    {hasAlign && (
                      <div className="text-[10px] text-primary">RT aligned</div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </Card>

        <Card className="border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Overlay
              </div>
              <h2 className="text-sm font-semibold">
                {overlayRuns.length === 0
                  ? "Select runs to start"
                  : `${overlayRuns.length} chromatograms`}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {hasAligned && (
                <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Checkbox
                    checked={useAlignedRt}
                    onCheckedChange={(v) => setUseAlignedRt(!!v)}
                  />
                  Use aligned RT
                </label>
              )}
              <Select value={viewMode} onValueChange={(v) => setViewMode(v as "stacked" | "single")}>
                <SelectTrigger className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">
                    <span className="flex items-center gap-1.5"><Layers className="h-3 w-3" /> Single overlay</span>
                  </SelectItem>
                  <SelectItem value="stacked">
                    <span className="flex items-center gap-1.5"><Columns2 className="h-3 w-3" /> Stacked</span>
                  </SelectItem>
                </SelectContent>
              </Select>
              <Select value={channel} onValueChange={(v) => setChannel(v as "tic" | "bpc")}>
                <SelectTrigger className="h-8 w-24 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tic">TIC</SelectItem>
                  <SelectItem value="bpc">BPC</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          </div>
          <div className="mt-3">
            {overlayRuns.length > 0 ? (
              viewMode === "single" ? (
                <ChromatogramPlot runs={overlayRuns} channel={channel} height={420} />
              ) : (
                <div className="space-y-2">
                  {overlayRuns.map((r) => (
                    <div key={r.id}>
                      <div className="mb-1 text-[10px] font-mono text-muted-foreground">{r.name}</div>
                      <ChromatogramPlot
                        runs={[r]}
                        channel={channel}
                        height={120}
                        compact
                      />
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="flex h-[420px] items-center justify-center text-xs text-muted-foreground">
                Pick runs from the left panel.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
