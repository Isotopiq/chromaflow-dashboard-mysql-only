import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import type { Column } from "@/lib/lab-types";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusDot } from "@/components/status-dot";
import { ColumnServicePanel } from "@/components/column-service-panel";
import { BufferExchangePanel } from "@/components/buffer-exchange-panel";
import { BufferCorrelationChart } from "@/components/buffer-correlation-chart";
import { ColumnHistoryTimeline } from "@/components/column-history-timeline";
import { ArrowLeft, Activity, FlaskConical, Gauge, Plus, Pencil, Trash2, AlertTriangle, Play, CheckCircle2, Loader2 } from "lucide-react";
import { runAnomalyChecks, resolveAnomalyCheck } from "@/lib/v3-functions";
import type { AnomalyCheck } from "@/lib/lab-types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import {
  createInjection,
  updateInjection,
  deleteInjection,
} from "@/lib/lab.functions";
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
  const { methods, runs, injections, bufferExchangeEvents, anomalyChecks, upsertAnomalyCheckLocal } = useLab();
  const upsertInjectionLocal = useLab((s) => s.upsertInjectionLocal);
  const removeInjectionLocal = useLab((s) => s.removeInjectionLocal);
  const createInjectionFn = useServerFn(createInjection);
  const updateInjectionFn = useServerFn(updateInjection);
  const deleteInjectionFn = useServerFn(deleteInjection);
  const runAnomalyFn = useServerFn(runAnomalyChecks);
  const resolveAnomalyFn = useServerFn(resolveAnomalyCheck);

  const columnInjections = useMemo(
    () => injections.filter((i) => i.columnId === column.id).sort((a, b) => a.injectionNum - b.injectionNum),
    [injections, column.id],
  );
  const nextInjectionNum = columnInjections.length > 0
    ? Math.max(...columnInjections.map((i) => i.injectionNum)) + 1
    : 1;

  const [showInjDialog, setShowInjDialog] = useState(false);
  const [editingInj, setEditingInj] = useState<string | null>(null);
  const [injSeq, setInjSeq] = useState("");
  const [injNum, setInjNum] = useState(1);
  const [injPressure, setInjPressure] = useState("");
  const [injMethod, setInjMethod] = useState("");
  const [injRun, setInjRun] = useState("");
  const [injNotes, setInjNotes] = useState("");
  const [savingInj, setSavingInj] = useState(false);
  const [deleteInjId, setDeleteInjId] = useState<string | null>(null);
  const [runningAnomalies, setRunningAnomalies] = useState(false);

  const columnBufferEvents = useMemo(
    () => bufferExchangeEvents.filter((e) => e.columnId === column.id),
    [bufferExchangeEvents, column.id],
  );
  const columnRuns = useMemo(
    () => runs.filter((r) => r.columnId === column.id),
    [runs, column.id],
  );
  const columnAnomalies = useMemo(
    () => anomalyChecks.filter((c) => c.columnId === column.id && !c.resolved),
    [anomalyChecks, column.id],
  );

  const handleRunAnomalies = async () => {
    setRunningAnomalies(true);
    try {
      const newChecks = await runAnomalyFn({ data: { columnId: column.id } });
      for (const c of newChecks) upsertAnomalyCheckLocal(c);
      toast.success(`Found ${newChecks.length} anomaly check${newChecks.length === 1 ? "" : "s"}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to run anomaly checks");
    } finally {
      setRunningAnomalies(false);
    }
  };

  const handleResolveAnomaly = async (id: string) => {
    try {
      const res = await resolveAnomalyFn({ data: { id } });
      upsertAnomalyCheckLocal(res);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to resolve");
    }
  };

  const openNewInj = () => {
    setEditingInj(null);
    setInjSeq("");
    setInjNum(nextInjectionNum);
    setInjPressure("");
    setInjMethod("");
    setInjRun("");
    setInjNotes("");
    setShowInjDialog(true);
  };

  const openEditInj = (id: string) => {
    const inj = columnInjections.find((i) => i.id === id);
    if (!inj) return;
    setEditingInj(id);
    setInjSeq(inj.sequenceName);
    setInjNum(inj.injectionNum);
    setInjPressure(inj.startingPressure != null ? String(inj.startingPressure) : "");
    setInjMethod(inj.methodId ?? "");
    setInjRun(inj.runId ?? "");
    setInjNotes(inj.notes);
    setShowInjDialog(true);
  };

  const saveInj = async () => {
    setSavingInj(true);
    try {
      const payload = {
        columnId: column.id,
        methodId: injMethod || null,
        sequenceName: injSeq,
        injectionNum: injNum,
        startingPressure: injPressure ? parseFloat(injPressure) : null,
        notes: injNotes,
        runId: injRun || null,
      };
      if (editingInj) {
        const updated = await updateInjectionFn({ data: { id: editingInj, ...payload } });
        upsertInjectionLocal(updated as any);
        toast.success("Injection updated");
      } else {
        const created = await createInjectionFn({ data: payload });
        upsertInjectionLocal(created as any);
        toast.success("Injection logged");
      }
      setShowInjDialog(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save injection");
    } finally {
      setSavingInj(false);
    }
  };

  const confirmDeleteInj = async () => {
    if (!deleteInjId) return;
    try {
      await deleteInjectionFn({ data: { id: deleteInjId } });
      removeInjectionLocal(deleteInjId);
      toast.success("Injection deleted");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete injection");
    } finally {
      setDeleteInjId(null);
    }
  };

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

      <ColumnServicePanel column={column} />

      <BufferExchangePanel column={column} />

      <BufferCorrelationChart runs={columnRuns} bufferEvents={columnBufferEvents} />

      <Card className="border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Anomaly checks
            </div>
            <h2 className="text-sm font-semibold">
              {columnAnomalies.length} active check{columnAnomalies.length === 1 ? "" : "s"}
            </h2>
          </div>
          <Button size="sm" variant="outline" onClick={handleRunAnomalies} disabled={runningAnomalies}>
            {runningAnomalies ? (
              <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Running…</>
            ) : (
              <><Play className="mr-1 h-3.5 w-3.5" /> Run checks</>
            )}
          </Button>
        </div>
        {columnAnomalies.length === 0 ? (
          <div className="mt-3 text-xs text-muted-foreground">
            No active anomalies. Click "Run checks" to scan for pressure spikes and peak issues.
          </div>
        ) : (
          <div className="mt-3 space-y-1 max-h-[300px] overflow-y-auto">
            {columnAnomalies.map((c: AnomalyCheck) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/40"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle
                    className={`h-3.5 w-3.5 shrink-0 ${
                      c.severity === "critical" ? "text-destructive" :
                      c.severity === "warning" ? "text-yellow-600 dark:text-yellow-400" :
                      "text-blue-600 dark:text-blue-400"
                    }`}
                  />
                  <div>
                    <span className="font-mono text-[10px] text-muted-foreground">{c.checkType.replace(/_/g, " ")}</span>
                    <p>{c.message}</p>
                    <span className="text-[10px] text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                  </div>
                </div>
                <button
                  onClick={() => handleResolveAnomaly(c.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  title="Resolve"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Injection log
            </div>
            <h2 className="text-sm font-semibold">{columnInjections.length} injection{columnInjections.length === 1 ? "" : "s"}</h2>
          </div>
          <Button size="sm" variant="outline" onClick={openNewInj}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Log Injection
          </Button>
        </div>
        {columnInjections.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 text-[10px] uppercase">Seq</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Inj #</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Method</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Start psi</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Run</TableHead>
                  <TableHead className="h-8 text-[10px] uppercase">Notes</TableHead>
                  <TableHead className="h-8 w-16" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {columnInjections.map((inj) => {
                  const m = methods.find((x) => x.id === inj.methodId);
                  const r = runs.find((x) => x.id === inj.runId);
                  return (
                    <TableRow key={inj.id}>
                      <TableCell className="py-1.5 text-xs">{inj.sequenceName || "—"}</TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{inj.injectionNum}</TableCell>
                      <TableCell className="py-1.5 text-xs">{m?.name ?? "—"}</TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{inj.startingPressure != null ? `${inj.startingPressure}` : "—"}</TableCell>
                      <TableCell className="py-1.5 text-xs font-mono">{r?.name ?? "—"}</TableCell>
                      <TableCell className="py-1.5 text-xs max-w-[200px] truncate">{inj.notes || "—"}</TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex gap-1">
                          <button onClick={() => openEditInj(inj.id)} className="text-muted-foreground hover:text-foreground">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button onClick={() => setDeleteInjId(inj.id)} className="text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

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

      <ColumnHistoryTimeline column={column} />

      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {column.notes || <span className="text-muted-foreground">No notes recorded.</span>}
        </p>
      </Card>

      <Dialog open={showInjDialog} onOpenChange={setShowInjDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingInj ? "Edit injection" : "Log injection"}</DialogTitle>
            <DialogDescription>
              Track individual injections on this column.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Sequence name</Label>
              <Input value={injSeq} onChange={(e) => setInjSeq(e.target.value)} placeholder="e.g. Batch-2026-001" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label className="text-xs">Injection number</Label>
                <Input type="number" value={injNum} onChange={(e) => setInjNum(parseInt(e.target.value) || 1)} min={1} />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Starting pressure (bar)</Label>
                <Input type="number" value={injPressure} onChange={(e) => setInjPressure(e.target.value)} placeholder="e.g. 380" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Method</Label>
              <Select value={injMethod} onValueChange={setInjMethod}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select method" /></SelectTrigger>
                <SelectContent>
                  {methods.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Linked run (optional)</Label>
              <Select value={injRun} onValueChange={setInjRun}>
                <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {linkedRuns.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Notes</Label>
              <Input value={injNotes} onChange={(e) => setInjNotes(e.target.value)} placeholder="Optional notes" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowInjDialog(false)}>Cancel</Button>
            <Button onClick={saveInj} disabled={savingInj || !injSeq}>
              {savingInj ? "Saving…" : editingInj ? "Update" : "Log injection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteInjId} onOpenChange={(open) => { if (!open) setDeleteInjId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete injection record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the injection record. The linked run will be unlinked.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteInj}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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