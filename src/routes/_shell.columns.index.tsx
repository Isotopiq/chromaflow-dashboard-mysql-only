import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { Plus, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { logColumnService } from "@/lib/lab.functions";
import type { Column } from "@/lib/lab-types";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { toast } from "sonner";
import { upsertColumn } from "@/lib/lab.functions";
import { ColumnFormDialog, type ColumnFormValues } from "@/components/column-form-dialog";

export const Route = createFileRoute("/_shell/columns/")({
  component: ColumnsList,
});

function ColumnsList() {
  const { columns, upsertColumnLocal } = useLab();
  const upsertFn = useServerFn(upsertColumn);
  const serviceFn = useServerFn(logColumnService);
  const [open, setOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<Column | null>(null);
  const [resetting, setResetting] = useState(false);

  const confirmReset = async () => {
    if (!resetTarget) return;
    setResetting(true);
    try {
      const res = await serviceFn({
        data: {
          columnId: resetTarget.id,
          kind: "guard_change",
          resetUsage: true,
          resetInstalledAt: true,
          status: "healthy",
          serial: "",
          notes: "Guard change / column replaced — injection count reset.",
        },
      });
      upsertColumnLocal(res.column);
      toast.success(`Injection count reset for "${res.column.name}"`);
      setResetTarget(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to reset injection count");
    } finally {
      setResetting(false);
    }
  };

  const handleSubmit = async (values: ColumnFormValues) => {
    try {
      const saved = await upsertFn({ data: values as any });
      upsertColumnLocal(saved);
      toast.success(`Column "${saved.name}" added`);
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save column");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Inventory
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Column library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track usage, pressure trends and lifetime per column.
          </p>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add column
        </Button>
      </div>

      {columns.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 border-dashed border-border bg-card p-10 text-center">
          <div className="text-sm font-medium">No columns yet</div>
          <p className="max-w-sm text-xs text-muted-foreground">
            Add your first column to start tracking injections, pressure trends and method
            assignments.
          </p>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add column
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {columns.map((c) => {
            const pct = Math.min(100, (c.injectionsUsed / c.ratedInjections) * 100);
            const trendData = c.pressureTrend.map((p, i) => ({ i, p }));
            return (
              <Link
                key={c.id}
                to="/columns/$columnId"
                params={{ columnId: c.id }}
                className="group"
              >
                <Card className="h-full border-border bg-card p-4 transition-colors group-hover:border-primary/60">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusDot status={c.status} />
                        <span className="text-sm font-semibold">{c.name}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {c.manufacturer} · {c.dimensions} · {c.particleSize}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {c.status}
                      </Badge>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        aria-label="Reset injection count"
                        title="Reset injection count / log guard change"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setResetTarget(c);
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-4 flex items-end justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                        Lifetime
                      </div>
                      <div className="font-mono text-lg">
                        {c.injectionsUsed}
                        <span className="text-xs text-muted-foreground">
                          {" "}
                          / {c.ratedInjections}
                        </span>
                      </div>
                    </div>
                    <div className="h-12 w-32">
                      <ResponsiveContainer>
                        <LineChart data={trendData}>
                          <YAxis hide domain={["dataMin", "dataMax"]} />
                          <Line
                            dataKey="p"
                            type="monotone"
                            stroke="var(--chart-1)"
                            strokeWidth={1.5}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                  <Progress value={pct} className="mt-2 h-1" />
                  <div className="mt-2 text-[10px] text-muted-foreground">
                    Pressure trend (last 12 batches)
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <ColumnFormDialog open={open} onOpenChange={setOpen} onSubmit={handleSubmit} />

      <AlertDialog
        open={!!resetTarget}
        onOpenChange={(o) => !resetting && !o && setResetTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset injection count?</AlertDialogTitle>
            <AlertDialogDescription>
              {resetTarget
                ? `"${resetTarget.name}" is at ${resetTarget.injectionsUsed} / ${resetTarget.ratedInjections} injections. This logs a guard change, resets the counter to 0, clears the pressure trend and marks the column healthy. Open the column page for more service options.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset} disabled={resetting}>
              {resetting ? "Resetting…" : "Reset & log"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
