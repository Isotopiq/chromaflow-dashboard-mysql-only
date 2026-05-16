import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
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
  const [open, setOpen] = useState(false);

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
                    <Badge variant="outline" className="text-[10px] capitalize">
                      {c.status}
                    </Badge>
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
    </div>
  );
}
