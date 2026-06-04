import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, FlaskConical, Columns3, AlertTriangle, ArrowRight, Beaker } from "lucide-react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { KpiCard } from "@/components/kpi-card";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { StatusDot } from "@/components/status-dot";
import { ago } from "@/lib/time";

export const Route = createFileRoute("/_shell/")({
  component: Dashboard,
});

function Dashboard() {
  const { runs, methods, columns, batches } = useLab();
  const validated = methods.filter((m) => m.status === "validated").length;
  const eolColumns = columns.filter((c) => c.status !== "healthy").length;
  const recentRuns = runs.slice(0, 4);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Hero */}
      <section className="bg-grid relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-card to-background p-6">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-primary">
              Method development overview
            </div>
            <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight">
              Your lab, end to end —{" "}
              <span className="text-primary">from raw mzML to validated method.</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Compare runs, track column lifetimes, annotate metabolites and ship reports without
              leaving the workspace.
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/methods/new">New method</Link>
            </Button>
            <Button asChild size="sm">
              <Link to="/runs">
                Upload run <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Validated methods"
          value={`${validated} / ${methods.length}`}
          icon={FlaskConical}
          tone="ok"
        />
        <KpiCard
          label="Runs (last 14d)"
          value={String(runs.length)}
          icon={Activity}
        />
        <KpiCard
          label="Active columns"
          value={String(columns.length)}
          delta={`${eolColumns} need attention`}
          icon={Columns3}
          tone={eolColumns > 0 ? "warn" : "ok"}
        />
        <KpiCard
          label="Open batches"
          value={String(batches.filter((b) => b.status !== "complete").length)}
          delta={`${batches.length} total`}
          icon={Beaker}
        />
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent runs */}
        <Card className="lg:col-span-2 border-border bg-card p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Recent runs
              </div>
              <h2 className="text-sm font-semibold">Latest acquisitions</h2>
            </div>
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link to="/runs">View all</Link>
            </Button>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            {recentRuns.map((r) => {
              const method = methods.find((m) => m.id === r.methodId);
              return (
                <Link
                  key={r.id}
                  to="/runs/$runId"
                  params={{ runId: r.id }}
                  className="group block rounded-lg border border-border bg-surface-elevated p-3 transition-colors hover:border-primary/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-mono text-xs font-medium">{r.name}</div>
                    <Badge variant="outline" className="text-[10px]">
                      {r.fileFormat}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {method?.name} · {ago(r.acquiredAt)}
                  </div>
                  <div className="mt-2 -mb-1">
                    <ChromatogramPlot runs={[r]} height={80} compact />
                  </div>
                </Link>
              );
            })}
          </div>
        </Card>

        {/* Column health */}
        <Card className="border-border bg-card p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Inventory
              </div>
              <h2 className="text-sm font-semibold">Column health</h2>
            </div>
            <Button asChild size="sm" variant="ghost" className="h-7 text-xs">
              <Link to="/columns">Manage</Link>
            </Button>
          </div>
          <div className="flex flex-col divide-y divide-border">
            {columns.map((c) => {
              const pct = Math.min(100, (c.injectionsUsed / c.ratedInjections) * 100);
              return (
                <Link
                  key={c.id}
                  to="/columns/$columnId"
                  params={{ columnId: c.id }}
                  className="flex flex-col gap-1.5 p-3 transition-colors hover:bg-accent/30"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusDot status={c.status} />
                      <span className="text-xs font-medium">{c.name}</span>
                    </div>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {c.injectionsUsed}/{c.ratedInjections}
                    </span>
                  </div>
                  <Progress value={pct} className="h-1" />
                </Link>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Alerts */}
      {eolColumns > 0 && (
        <Card className="flex items-start gap-3 border-[color:var(--status-warn)]/40 bg-[color:var(--status-warn)]/5 p-4">
          <AlertTriangle className="h-4 w-4 text-[color:var(--status-warn)]" />
          <div className="flex-1 text-xs">
            <div className="font-medium">{eolColumns} column(s) need attention</div>
            <p className="mt-0.5 text-muted-foreground">
              One or more columns are near or past their rated injection lifetime. Review pressure
              trends and replace before the next batch.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/columns">Review</Link>
          </Button>
        </Card>
      )}
    </div>
  );
}
