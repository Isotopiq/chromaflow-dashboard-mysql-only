import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useLab } from "@/lib/store";
import type { Column } from "@/lib/lab-types";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/status-dot";
import { ArrowLeft, Activity, FlaskConical, Gauge } from "lucide-react";
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
  component: ColumnDetailGate,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Column not found.</div>
  ),
});

function ColumnDetailGate() {
  const { columnId } = Route.useParams();
  const { columns, hydrated } = useLab();
  const column = columns.find((c) => c.id === columnId);

  if (!column) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Link
          to="/columns"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All columns
        </Link>
        <Card className="border-border bg-card p-6">
          <div className="text-sm font-medium">
            {hydrated ? "Column not found" : "Loading column…"}
          </div>
          {hydrated && (
            <p className="mt-1 text-xs text-muted-foreground">
              This column is no longer available or you may not have access to it.
            </p>
          )}
        </Card>
      </div>
    );
  }

  return <ColumnDetail column={column} />;
}

function ColumnDetail({ column }: { column: Column }) {
  const { methods, runs } = useLab();
  const linkedMethods = useMemo(
    () => methods.filter((m) => m.columnId === column.id),
    [methods, column.id],
  );
  const linkedRuns = useMemo(
    () => runs.filter((r) => r.columnId === column.id),
    [runs, column.id],
  );
  const trend = useMemo(
    () => column.pressureTrend.map((pressure, i) => ({ batch: `B${i + 1}`, pressure })),
    [column.pressureTrend],
  );
  const ratedInjections = column.ratedInjections > 0 ? column.ratedInjections : 1000;
  const pct = Math.min(100, (column.injectionsUsed / ratedInjections) * 100);
  const latestPressure = column.pressureTrend.at(-1);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link
            to="/columns"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> All columns
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <StatusDot status={column.status} />
            <h1 className="break-words text-2xl font-semibold tracking-tight">{column.name}</h1>
            <Badge variant="outline" className="text-[10px] capitalize">
              {column.status}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {column.manufacturer && <span>{column.manufacturer}</span>}
            {column.chemistry && <span>· {column.chemistry}</span>}
            {column.dimensions && <span>· {column.dimensions}</span>}
            {column.particleSize && <span>· {column.particleSize}</span>}
            {column.serial && <span className="font-mono">· S/N {column.serial}</span>}
          </div>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/columns">Manage library</Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <MetricCard
          icon={<Gauge className="h-4 w-4" />}
          label="Lifetime"
          value={`${column.injectionsUsed} / ${ratedInjections}`}
          detail={`${pct.toFixed(0)}% of rated injections used`}
        >
          <Progress value={pct} className="mt-3 h-1.5" />
        </MetricCard>
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label="Latest pressure"
          value={latestPressure == null ? "—" : `${latestPressure} bar`}
          detail="Most recent pressure sample"
        />
        <MetricCard
          icon={<FlaskConical className="h-4 w-4" />}
          label="Installed"
          value={column.installedAt ? String(column.installedAt).slice(0, 10) : "—"}
          detail={`${linkedRuns.length} linked run${linkedRuns.length === 1 ? "" : "s"}`}
        />
      </div>

      <Card className="border-border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Pressure trend
            </div>
            <h2 className="text-sm font-semibold">Last {trend.length} samples</h2>
          </div>
        </div>
        <div className="mt-3 h-64">
          {trend.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No pressure samples yet.
            </div>
          ) : (
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
                  dataKey="pressure"
                  type="monotone"
                  stroke="var(--chart-1)"
                  strokeWidth={1.6}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Linked methods ({linkedMethods.length})
          </div>
          <div className="mt-2 space-y-1">
            {linkedMethods.length === 0 ? (
              <div className="text-xs text-muted-foreground">No methods linked.</div>
            ) : (
              linkedMethods.map((method) => (
                <Link
                  key={method.id}
                  to="/methods/$methodId"
                  params={{ methodId: method.id }}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-accent/40"
                >
                  <span className="truncate">{method.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{method.modality}</span>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Recent runs ({linkedRuns.length})
          </div>
          <div className="mt-2 space-y-1">
            {linkedRuns.length === 0 ? (
              <div className="text-xs text-muted-foreground">No runs on this column yet.</div>
            ) : (
              linkedRuns.slice(0, 8).map((run) => (
                <Link
                  key={run.id}
                  to="/runs/$runId"
                  params={{ runId: run.id }}
                  className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-accent/40"
                >
                  <span className="truncate font-mono">{run.name}</span>
                  <span className="text-[10px] text-muted-foreground">{run.peaks.length} peaks</span>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {column.notes || <span className="text-muted-foreground">No notes recorded.</span>}
        </p>
      </Card>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-2 break-words font-mono text-2xl">{value}</div>
      {children}
      <div className="mt-2 text-[11px] text-muted-foreground">{detail}</div>
    </Card>
  );
}