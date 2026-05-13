import { createFileRoute, Link } from "@tanstack/react-router";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export const Route = createFileRoute("/_shell/batches")({
  component: Batches,
});

function Batches() {
  const { batches, runs, users } = useLab();

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Inventory
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Batches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Group runs and methods into experiments and release lots.
          </p>
        </div>
        <Button size="sm">
          <Plus className="mr-1 h-3.5 w-3.5" /> New batch
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {batches.map((b) => {
          const owner = users.find((u) => u.id === b.owner);
          const batchRuns = runs.filter((r) => r.batchId === b.id);
          return (
            <Card key={b.id} className="border-border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">{b.name}</div>
                  <div className="text-[11px] text-muted-foreground">{b.project}</div>
                </div>
                <Badge variant="outline" className="text-[10px]">
                  <StatusDot status={b.status} className="mr-1" />
                  {b.status.replace("_", " ")}
                </Badge>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Samples" value={String(b.sampleCount)} />
                <Stat label="Runs" value={String(batchRuns.length)} />
                <Stat label="Owner" value={owner?.avatar ?? "—"} />
              </div>

              <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
                Runs
              </div>
              <div className="mt-2 space-y-1">
                {batchRuns.slice(0, 4).map((r) => (
                  <Link
                    key={r.id}
                    to="/runs/$runId"
                    params={{ runId: r.id }}
                    className="block truncate rounded-md px-2 py-1 font-mono text-[11px] hover:bg-accent/40"
                  >
                    {r.name}
                  </Link>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-2">
      <div className="font-mono text-sm">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
