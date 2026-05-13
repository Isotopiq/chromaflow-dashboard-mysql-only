import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-dot";
import { ArrowLeft } from "lucide-react";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  YAxis,
  XAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export const Route = createFileRoute("/_shell/columns/$columnId")({
  component: ColumnDetail,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Column not found.</div>
  ),
});

function ColumnDetail() {
  const { columnId } = Route.useParams();
  const { columns, methods, runs } = useLab();
  const col = columns.find((c) => c.id === columnId);
  if (!col) throw notFound();
  const linkedMethods = methods.filter((m) => m.columnId === col.id);
  const linkedRuns = runs.filter((r) => r.columnId === col.id);
  const pct = Math.min(100, (col.injectionsUsed / col.ratedInjections) * 100);
  const trend = col.pressureTrend.map((p, i) => ({ batch: `B${i + 1}`, p }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link
          to="/columns"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All columns
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <StatusDot status={col.status} />
          <h1 className="text-2xl font-semibold tracking-tight">{col.name}</h1>
          <Badge variant="outline" className="ml-2 text-[10px] capitalize">
            {col.status}
          </Badge>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          {col.manufacturer} · {col.chemistry} · {col.dimensions} · {col.particleSize} · S/N {col.serial}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Lifetime
          </div>
          <div className="mt-2 font-mono text-3xl">
            {col.injectionsUsed}
            <span className="text-base text-muted-foreground"> / {col.ratedInjections}</span>
          </div>
          <Progress value={pct} className="mt-3 h-1.5" />
          <div className="mt-1 text-[11px] text-muted-foreground">
            {pct.toFixed(0)}% of rated injections used
          </div>
          <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
            Installed
          </div>
          <div className="mt-1 font-mono text-xs">{col.installedAt}</div>
        </Card>

        <Card className="border-border bg-card p-4 lg:col-span-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Pressure trend (bar)
          </div>
          <div className="mt-3 h-48">
            <ResponsiveContainer>
              <LineChart data={trend}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                <XAxis
                  dataKey="batch"
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                />
                <Line
                  dataKey="p"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={1.6}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
        <p className="mt-2 text-sm">{col.notes}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Linked methods ({linkedMethods.length})
          </div>
          <div className="mt-2 space-y-1">
            {linkedMethods.map((m) => (
              <Link
                key={m.id}
                to="/methods/$methodId"
                params={{ methodId: m.id }}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent/40"
              >
                <span>{m.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{m.modality}</span>
              </Link>
            ))}
            {linkedMethods.length === 0 && (
              <div className="text-xs text-muted-foreground">No methods linked.</div>
            )}
          </div>
        </Card>
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Recent runs on this column ({linkedRuns.length})
          </div>
          <div className="mt-2 space-y-1">
            {linkedRuns.slice(0, 6).map((r) => (
              <Link
                key={r.id}
                to="/runs/$runId"
                params={{ runId: r.id }}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent/40"
              >
                <span className="truncate font-mono">{r.name}</span>
                <span className="text-[10px] text-muted-foreground">{r.peaks.length} peaks</span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm">
          Log maintenance event
        </Button>
      </div>
    </div>
  );
}
