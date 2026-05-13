import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
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
import { ago } from "@/lib/mock-data";

export const Route = createFileRoute("/_shell/overlay")({
  component: Overlay,
});

function Overlay() {
  const { runs, methods } = useLab();
  const [selected, setSelected] = useState<string[]>(runs.slice(0, 3).map((r) => r.id));
  const [channel, setChannel] = useState<"tic" | "bpc">("tic");

  const overlayRuns = selected
    .map((id) => runs.find((r) => r.id === id))
    .filter((r): r is (typeof runs)[number] => Boolean(r));

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Acquisition
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Overlay workspace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick runs to overlay. Compare retention drift, peak shape and intensity across acquisitions.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="border-border bg-card p-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Runs ({selected.length} selected)
          </div>
          <div className="mt-2 max-h-[480px] space-y-1 overflow-y-auto pr-1">
            {runs.map((r) => {
              const checked = selected.includes(r.id);
              const method = methods.find((m) => m.id === r.methodId);
              return (
                <label
                  key={r.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs hover:bg-accent/30"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) =>
                      setSelected(v ? [...selected, r.id] : selected.filter((x) => x !== r.id))
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono">{r.name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {method?.name} · {ago(r.acquiredAt)}
                    </div>
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
              <Select value={channel} onValueChange={(v) => setChannel(v as "tic" | "bpc")}>
                <SelectTrigger className="h-8 w-32 text-xs">
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
              <ChromatogramPlot runs={overlayRuns} channel={channel} height={420} />
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
