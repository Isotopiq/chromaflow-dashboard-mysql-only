import { createFileRoute, Link } from "@tanstack/react-router";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { StatusDot } from "@/components/status-dot";
import { ArrowLeft, GitBranch, Edit3 } from "lucide-react";
import type { Method } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/methods/$methodId")({
  component: MethodDetailGate,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Method not found.</div>
  ),
});

function MethodDetailGate() {
  const { methodId } = Route.useParams();
  const { methods, hydrated } = useLab();
  const method = methods.find((m) => m.id === methodId);
  if (!method) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Link
          to="/methods"
          className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All methods
        </Link>
        <Card className="border-border bg-card p-6">
          <div className="text-sm font-medium">
            {hydrated ? "Method not found" : "Loading method…"}
          </div>
          {hydrated && (
            <p className="mt-1 text-xs text-muted-foreground">
              This method is no longer available or you may not have access to it.
            </p>
          )}
        </Card>
      </div>
    );
  }
  return <MethodDetail method={method} />;
}

function MethodDetail({ method }: { method: Method }) {
  const { columns, runs } = useLab();
  const column = columns.find((c) => c.id === method.columnId);
  const methodRuns = runs.filter((r) => r.methodId === method.id);


  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link
            to="/methods"
            className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" /> All methods
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{method.name}</h1>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-mono">{method.modality}</span>
            <span>·</span>
            <span>{column?.name}</span>
            <span>·</span>
            <span className="flex items-center gap-1.5">
              <StatusDot status={method.status} />
              <span className="capitalize">{method.status}</span>
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/methods/$methodId/history" params={{ methodId: method.id }}>
              <GitBranch className="mr-1 h-3.5 w-3.5" /> Revision history
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/methods/$methodId/edit" params={{ methodId: method.id }}>
              <Edit3 className="mr-1 h-3.5 w-3.5" /> Edit method
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card p-4 lg:col-span-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Chromatographic parameters
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
            <Field label="Mobile phase A" value={method.mobilePhaseA} />
            <Field label="Mobile phase B" value={method.mobilePhaseB} />
            <Field label="Flow rate" value={`${method.flowRate} mL/min`} />
            <Field label="Column temp" value={`${method.columnTemp} °C`} />
            <Field label="Injection vol" value={`${method.injectionVolume} µL`} />
            <Field label="Detector" value={method.detector} />
          </dl>

          <div className="mt-5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Gradient
          </div>
          <Table className="mt-2">
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[10px] uppercase tracking-wider">Time (min)</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">% B</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Flow (mL/min)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {method.gradient.map((g, i) => (
                <TableRow key={i} className="font-mono text-xs">
                  <TableCell>{g.time.toFixed(1)}</TableCell>
                  <TableCell>{g.pctB}</TableCell>
                  <TableCell>{g.flow.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            MS settings
          </div>
          <dl className="mt-3 space-y-3 text-xs">
            <Field label="Ionization" value={method.msIonization} />
            <Field
              label="Scan range"
              value={`${method.msScanRange[0]} – ${method.msScanRange[1]} m/z`}
            />
            <Field label="Detector" value={method.detector} />
          </dl>

          <div className="mt-5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Tags
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {method.tags.map((t) => (
              <Badge key={t} variant="outline" className="text-[10px]">
                {t}
              </Badge>
            ))}
          </div>

          <div className="mt-5 text-[10px] uppercase tracking-widest text-muted-foreground">
            Notes
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{method.notes}</p>
        </Card>
      </div>

      {methodRuns.length > 0 && (
        <Card className="border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Linked runs ({methodRuns.length})
              </div>
              <h2 className="text-sm font-semibold">Representative chromatogram overlay</h2>
            </div>
            <Button asChild size="sm" variant="outline">
              <Link to="/overlay">Open in workspace</Link>
            </Button>
          </div>
          <div className="mt-3">
            <ChromatogramPlot runs={methodRuns} height={260} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {methodRuns.map((r) => (
              <Link
                key={r.id}
                to="/runs/$runId"
                params={{ runId: r.id }}
                className="flex items-center justify-between rounded-md border border-border bg-surface-elevated px-3 py-2 text-xs transition-colors hover:border-primary/60"
              >
                <span className="truncate font-mono">{r.name}</span>
                <span className="text-muted-foreground">{r.peaks.length} peaks</span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-xs">{value}</dd>
    </div>
  );
}
