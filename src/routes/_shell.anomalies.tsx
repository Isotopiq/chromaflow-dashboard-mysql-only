import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle, CheckCircle2, Play, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  runAnomalyChecks, listAnomalyChecks, resolveAnomalyCheck,
} from "@/lib/v3-functions";
import type { AnomalyCheck, Batch, Column } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/anomalies")({
  component: AnomalyDashboard,
});

const SEVERITY_COLORS: Record<AnomalyCheck["severity"], string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  info: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
};

const SCOPE_LABELS: Record<AnomalyCheck["scope"], string> = {
  batch: "Batch",
  sample: "Sample",
  compound: "Compound",
  qc: "QC",
};

function AnomalyDashboard() {
  const { anomalyChecks, batches, columns, upsertAnomalyCheckLocal } = useLab();
  const runFn = useServerFn(runAnomalyChecks);
  const listFn = useServerFn(listAnomalyChecks);
  const resolveFn = useServerFn(resolveAnomalyCheck);

  const [scopeFilter, setScopeFilter] = useState<string>("__none__");
  const [batchFilter, setBatchFilter] = useState<string>("__none__");
  const [showResolved, setShowResolved] = useState(false);
  const [running, setRunning] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);

  // Run dialog state
  const [runScope, setRunScope] = useState<"batch" | "column">("batch");
  const [runBatchId, setRunBatchId] = useState<string>("__none__");
  const [runColumnId, setRunColumnId] = useState<string>("__none__");

  // Filter checks
  const filteredChecks = useMemo(() => {
    return anomalyChecks.filter((c) => {
      if (scopeFilter !== "__none__" && c.scope !== scopeFilter) return false;
      if (batchFilter !== "__none__" && c.batchId !== batchFilter) return false;
      if (!showResolved && c.resolved) return false;
      return true;
    });
  }, [anomalyChecks, scopeFilter, batchFilter, showResolved]);

  const counts = useMemo(() => {
    const active = filteredChecks.filter((c) => !c.resolved);
    return {
      critical: active.filter((c) => c.severity === "critical").length,
      warning: active.filter((c) => c.severity === "warning").length,
      info: active.filter((c) => c.severity === "info").length,
      total: active.length,
    };
  }, [filteredChecks]);

  const handleRunChecks = async () => {
    setRunning(true);
    try {
      const batchId = runScope === "batch" && runBatchId !== "__none__" ? runBatchId : null;
      const columnId = runScope === "column" && runColumnId !== "__none__" ? runColumnId : null;
      const newChecks = await runFn({ data: { batchId, columnId } });
      for (const c of newChecks) {
        upsertAnomalyCheckLocal(c);
      }
      toast.success(`Found ${newChecks.length} anomaly check${newChecks.length === 1 ? "" : "s"}`);
      setShowRunDialog(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to run anomaly checks");
    } finally {
      setRunning(false);
    }
  };

  const handleResolve = async (id: string) => {
    try {
      const res = await resolveFn({ data: { id } });
      upsertAnomalyCheckLocal(res);
      toast.success("Anomaly resolved");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to resolve anomaly");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Quality
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Anomaly checks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Automated checks spanning batches, samples, compounds, and QC runs.
            Run checks to detect RT drift, area RSD, peak-shape degradation, signal dropoff,
            QC accuracy, and pressure spikes.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowRunDialog(true)}>
          <Play className="mr-1 h-3.5 w-3.5" /> Run checks
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className={`border-border bg-card p-4 ${counts.critical > 0 ? "border-destructive/30" : ""}`}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Critical</div>
              <div className="text-2xl font-semibold">{counts.critical}</div>
            </div>
          </div>
        </Card>
        <Card className={`border-border bg-card p-4 ${counts.warning > 0 ? "border-yellow-500/30" : ""}`}>
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Warning</div>
              <div className="text-2xl font-semibold">{counts.warning}</div>
            </div>
          </div>
        </Card>
        <Card className="border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Info</div>
              <div className="text-2xl font-semibold">{counts.info}</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-border bg-card p-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Select value={scopeFilter} onValueChange={setScopeFilter}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All scopes</SelectItem>
                <SelectItem value="batch">Batch</SelectItem>
                <SelectItem value="sample">Sample</SelectItem>
                <SelectItem value="compound">Compound</SelectItem>
                <SelectItem value="qc">QC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Select value={batchFilter} onValueChange={setBatchFilter}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">All batches</SelectItem>
                {batches.map((b: Batch) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Select value={showResolved ? "yes" : "no"} onValueChange={(v) => setShowResolved(v === "yes")}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">Active only</SelectItem>
                <SelectItem value="yes">Show resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Anomaly table */}
      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Checks ({filteredChecks.length})
        </div>
        {filteredChecks.length === 0 ? (
          <div className="mt-3 flex h-32 items-center justify-center text-xs text-muted-foreground">
            No anomaly checks found. Click "Run checks" to scan for issues.
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-[10px] uppercase">Severity</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Scope</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Check type</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Message</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Date</TableHead>
                  <TableHead className="h-8 w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredChecks.map((c: AnomalyCheck) => (
                  <TableRow key={c.id}>
                    <TableCell className="py-1.5">
                      <Badge variant="outline" className={`text-[10px] ${SEVERITY_COLORS[c.severity]}`}>
                        {c.severity}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-1.5 text-xs">{SCOPE_LABELS[c.scope]}</TableCell>
                    <TableCell className="py-1.5 text-xs font-mono">{c.checkType.replace(/_/g, " ")}</TableCell>
                    <TableCell className="py-1.5 text-xs max-w-[400px]">
                      {c.message}
                      {c.batchId && (
                        <Link
                          to="/batches/$batchId"
                          params={{ batchId: c.batchId }}
                          className="ml-1 text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                        >
                          view batch
                        </Link>
                      )}
                      {c.columnId && (
                        <Link
                          to="/columns/$columnId"
                          params={{ columnId: c.columnId }}
                          className="ml-1 text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                        >
                          view column
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="py-1.5">
                      {c.resolved ? (
                        <span className="text-[10px] text-muted-foreground">resolved</span>
                      ) : (
                        <button
                          onClick={() => handleResolve(c.id)}
                          className="text-muted-foreground hover:text-foreground"
                          title="Resolve"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Run checks dialog */}
      <Dialog open={showRunDialog} onOpenChange={(o) => !running && setShowRunDialog(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Run anomaly checks</DialogTitle>
            <DialogDescription>
              Select a scope to scan for RT drift, area RSD, peak-shape degradation,
              signal dropoff, QC accuracy, and pressure spikes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            <div>
              <Select value={runScope} onValueChange={(v) => setRunScope(v as "batch" | "column")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="batch">Batch scope</SelectItem>
                  <SelectItem value="column">Column scope</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {runScope === "batch" ? (
              <div>
                <Select value={runBatchId} onValueChange={setRunBatchId}>
                  <SelectTrigger><SelectValue placeholder="Select batch" /></SelectTrigger>
                  <SelectContent>
                    {batches.map((b: Batch) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Select value={runColumnId} onValueChange={setRunColumnId}>
                  <SelectTrigger><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    {columns.map((c: Column) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setShowRunDialog(false)} disabled={running}>
              Cancel
            </Button>
            <Button type="button" onClick={handleRunChecks} disabled={running}>
              {running ? (
                <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Running…</>
              ) : (
                <><Play className="mr-1 h-3.5 w-3.5" /> Run checks</>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
