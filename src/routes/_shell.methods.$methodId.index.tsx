import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
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
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { ArrowLeft, GitBranch, Edit3, Trash2, Archive, Download, Save, Plus, X } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { deleteMethod, archiveMethod, downloadMethodFile } from "@/lib/lab.functions";
import { useUpsertMethod } from "@/lib/store";
import type { Method, MsScan } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/methods/$methodId/")({
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
  const { columns, runs, currentUser, removeMethodLocal, archiveMethodLocal, upsertMethodLocal } = useLab();
  const deleteFn = useServerFn(deleteMethod);
  const archiveFn = useServerFn(archiveMethod);
  const downloadFn = useServerFn(downloadMethodFile);
  const upsertMethod = useUpsertMethod();
  const nav = useNavigate();
  const [showDelete, setShowDelete] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);

  // Editable MS scan state
  const [editingScans, setEditingScans] = useState(false);
  const [scanDraft, setScanDraft] = useState<MsScan[]>(method.msScans ?? []);
  const [savingScans, setSavingScans] = useState(false);

  // Sync scanDraft when method data loads or changes (e.g. after hydration)
  useEffect(() => {
    if (!editingScans) {
      setScanDraft(method.msScans ?? []);
    }
  }, [method.msScans, editingScans]);

  const column = columns.find((c) => c.id === method.columnId);
  const methodRuns = runs.filter((r) => r.methodId === method.id);
  const isAdmin = currentUser?.role === "admin";
  const canModify = isAdmin || !method.createdBy || method.createdBy === currentUser?.id;

  function updateScan(index: number, patch: Partial<MsScan>) {
    setScanDraft((prev) => prev.map((s, j) => (j === index ? { ...s, ...patch } : s)));
  }

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      const res = await deleteFn({ data: { methodId: method.id, force: true } });
      if (res.missing) {
        toast.info("Method no longer exists");
      } else {
        removeMethodLocal(method.id);
        toast.success(`Method "${method.name}" deleted`);
      }
      nav({ to: "/methods" });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete method");
    } finally {
      setDeleting(false);
      setShowDelete(false);
    }
  };

  const confirmArchive = async () => {
    setArchiving(true);
    try {
      const res = await archiveFn({ data: { methodId: method.id } });
      if (res.missing) {
        toast.info("Method no longer exists");
      } else {
        archiveMethodLocal(method.id);
        toast.success(`Method "${method.name}" archived`);
      }
      setShowArchive(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to archive method");
    } finally {
      setArchiving(false);
    }
  };

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
          {method.status !== "archived" && canModify && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowArchive(true)}
            >
              <Archive className="mr-1 h-3.5 w-3.5" /> Archive
            </Button>
          )}
          {canModify && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to="/methods/$methodId/history" params={{ methodId: method.id }}>
              <GitBranch className="mr-1 h-3.5 w-3.5" /> History
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/methods/$methodId/edit" params={{ methodId: method.id }}>
              <Edit3 className="mr-1 h-3.5 w-3.5" /> Edit
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

          {/* Gradient profile visualization */}
          <div className="mt-4">
            <GradientProfilePlot gradient={method.gradient} flowRate={method.flowRate} />
          </div>
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

          {/* Method file download */}
          {method.methodFileName && (
            <div className="mt-5 border-t border-border pt-3">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Method file
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground">{method.methodFileName}</span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={async () => {
                    try {
                      const result = await downloadFn({ data: { methodId: method.id } });
                      window.open(result.url, "_blank");
                    } catch (e: any) {
                      toast.error(e?.message ?? "Download failed");
                    }
                  }}
                >
                  <Download className="mr-1 h-3 w-3" /> Download
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* MS Scan Definitions */}
      {((method.msScans && method.msScans.length > 0) || editingScans) && (
        <Card className="border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              MS Scan Definitions {editingScans ? `(${scanDraft.length})` : `(${method.msScans?.length ?? 0})`}
            </div>
            <div className="flex gap-2">
              {editingScans ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={savingScans}
                    onClick={() => {
                      setScanDraft(method.msScans ?? []);
                      setEditingScans(false);
                    }}
                  >
                    <X className="mr-1 h-3 w-3" /> Cancel
                  </Button>
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={savingScans}
                    onClick={async () => {
                      setSavingScans(true);
                      try {
                        const saved = await upsertMethod({ ...method, msScans: scanDraft } as any);
                        upsertMethodLocal(saved);
                        setEditingScans(false);
                        toast.success("MS scans updated");
                      } catch (e: any) {
                        toast.error(e?.message ?? "Save failed");
                      } finally {
                        setSavingScans(false);
                      }
                    }}
                  >
                    <Save className="mr-1 h-3 w-3" /> {savingScans ? "Saving…" : "Save"}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => {
                    setScanDraft(method.msScans ?? []);
                    setEditingScans(true);
                  }}
                >
                  <Edit3 className="mr-1 h-3 w-3" /> Edit scans
                </Button>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-3">
            {(editingScans ? scanDraft : method.msScans ?? []).map((scan, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  {editingScans ? (
                    <Select
                      value={scan.scanType}
                      onValueChange={(v) => updateScan(i, { scanType: v as MsScan["scanType"] })}
                    >
                      <SelectTrigger className="h-7 w-32 text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MS1">MS1</SelectItem>
                        <SelectItem value="ddMS2">ddMS2</SelectItem>
                        <SelectItem value="tSIM">tSIM</SelectItem>
                        <SelectItem value="tMS2">tMS2</SelectItem>
                        <SelectItem value="PRM">PRM</SelectItem>
                        <SelectItem value="AllIons">AllIons</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">{scan.scanType}</Badge>
                  )}
                  {editingScans ? (
                    <Input
                      value={scan.experimentName}
                      onChange={(e) => updateScan(i, { experimentName: e.target.value })}
                      className="h-7 flex-1 text-sm"
                      placeholder="Experiment name"
                    />
                  ) : (
                    <span className="text-sm font-medium">{scan.experimentName || `Scan ${i + 1}`}</span>
                  )}
                  {scan.startTimeMin != null && scan.endTimeMin != null && !editingScans && (
                    <span className="text-[10px] text-muted-foreground">
                      {scan.startTimeMin}–{scan.endTimeMin} min
                    </span>
                  )}
                  {editingScans && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => setScanDraft(scanDraft.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                {editingScans ? (
                  <EditableScanFields scan={scan} index={i} updateScan={updateScan} />
                ) : (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                      {scan.orbitrapResolution != null && (
                        <div><span className="text-muted-foreground">Resolution:</span> {scan.orbitrapResolution}</div>
                      )}
                      {scan.scanRangeMz && (
                        <div><span className="text-muted-foreground">Scan range:</span> {scan.scanRangeMz[0]}–{scan.scanRangeMz[1]} m/z</div>
                      )}
                      {scan.agcTarget && (
                        <div><span className="text-muted-foreground">AGC target:</span> {scan.agcTarget}</div>
                      )}
                      {scan.microscans != null && (
                        <div><span className="text-muted-foreground">Microscans:</span> {scan.microscans}</div>
                      )}
                      {scan.rfLensPct != null && (
                        <div><span className="text-muted-foreground">RF lens:</span> {scan.rfLensPct}%</div>
                      )}
                      {scan.maxInjectionTimeMode && (
                        <div><span className="text-muted-foreground">IT mode:</span> {scan.maxInjectionTimeMode}</div>
                      )}
                      {scan.maxInjectionTimeMs != null && (
                        <div><span className="text-muted-foreground">Max IT:</span> {scan.maxInjectionTimeMs} ms</div>
                      )}
                      {scan.dataType && (
                        <div><span className="text-muted-foreground">Data type:</span> {scan.dataType}</div>
                      )}
                      {scan.polarity && (
                        <div><span className="text-muted-foreground">Polarity:</span> {scan.polarity}</div>
                      )}
                      {scan.sourceFragmentation != null && (
                        <div><span className="text-muted-foreground">Source frag:</span> {scan.sourceFragmentation ? "On" : "Off"}</div>
                      )}
                      {scan.isolationWindow && (
                        <div><span className="text-muted-foreground">Isolation:</span> {scan.isolationWindow}</div>
                      )}
                      {scan.isolationWindowMz != null && (
                        <div><span className="text-muted-foreground">Isolation window:</span> {scan.isolationWindowMz} m/z</div>
                      )}
                      {scan.maxMultiplexedIons != null && (
                        <div><span className="text-muted-foreground">Max multiplex:</span> {scan.maxMultiplexedIons}</div>
                      )}
                      {scan.intensityThreshold != null && (
                        <div><span className="text-muted-foreground">Min intensity:</span> {scan.intensityThreshold}</div>
                      )}
                      {scan.dynamicExclusionMode && (
                        <div><span className="text-muted-foreground">Dyn. exclusion:</span> {scan.dynamicExclusionMode}</div>
                      )}
                      {scan.isotopeExclusion && (
                        <div><span className="text-muted-foreground">Isotope excl:</span> {scan.isotopeExclusion}</div>
                      )}
                      {scan.precursorSelectionRange && (
                        <div><span className="text-muted-foreground">Precursor range:</span> {scan.precursorSelectionRange[0]}–{scan.precursorSelectionRange[1]} m/z</div>
                      )}
                    </div>
                    {scan.extraParams && scan.extraParams.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[10px] text-muted-foreground">
                          Extra parameters ({scan.extraParams.length})
                        </summary>
                        <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
                          {scan.extraParams.map((p, j) => (
                            <div key={j}>
                              <span className="text-muted-foreground">{p.key}:</span> {p.value}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          {editingScans && (
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setScanDraft([
                  ...scanDraft,
                  {
                    scanType: "MS1",
                    experimentName: "New Scan",
                    startTimeMin: null,
                    endTimeMin: null,
                    orbitrapResolution: null,
                    scanRangeMz: null,
                    agcTarget: null,
                    microscans: null,
                    rfLensPct: null,
                    maxInjectionTimeMode: null,
                    maxInjectionTimeMs: null,
                    dataType: null,
                    polarity: null,
                    sourceFragmentation: null,
                    lockMassInjection: null,
                    scanDescription: null,
                    isolationOffset: null,
                    isolationWindow: null,
                    isolationWindowMz: null,
                    multiplexIonsEnabled: null,
                    maxMultiplexedIons: null,
                    reportedMass: null,
                    turboTmt: null,
                    scanRangeMode: null,
                    intensityThreshold: null,
                    dynamicExclusionMode: null,
                    isotopeExclusion: null,
                    precursorSelectionRange: null,
                    extraParams: [],
                  },
                ])}
              >
                <Plus className="mr-1 h-3 w-3" /> Add scan
              </Button>
            </div>
          )}
        </Card>
      )}

      {/* Chromatogram overlay from linked runs (always visible) */}
      <Card className="border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Linked runs ({methodRuns.length})
            </div>
            <h2 className="text-sm font-semibold">Chromatogram overlay</h2>
          </div>
          {methodRuns.length > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link to="/overlay">Open in workspace</Link>
            </Button>
          )}
        </div>
        <div className="mt-3">
          {methodRuns.length > 0 ? (
            <ChromatogramPlot runs={methodRuns} height={260} />
          ) : (
            <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              No runs linked to this method yet. Upload a run and select this method to see its chromatogram here.
            </div>
          )}
        </div>
        {methodRuns.length > 0 && (
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
        )}
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete method "{method.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {methodRuns.length > 0 ? (
                <>
                  This method is linked to {methodRuns.length} run(s).
                  Deleting will unlink those runs (their method reference will be cleared).
                  This cannot be undone.
                </>
              ) : (
                <>This will permanently delete the method. This cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirmation */}
      <AlertDialog open={showArchive} onOpenChange={setShowArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive method "{method.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The method will be marked as archived. You can still find it by filtering.
              This can be undone by editing the method status.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiving}
              onClick={confirmArchive}
            >
              {archiving ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

function GradientProfilePlot({
  gradient,
  flowRate,
}: {
  gradient: Array<{ time: number; pctB: number; flow: number }>;
  flowRate: number;
}) {
  if (gradient.length === 0) return null;

  // Use raw gradient steps directly — linear interpolation draws straight
  // lines between setpoints, which is how HPLC gradients ramp.
  const data = gradient.map((g) => ({
    time: g.time,
    pctB: g.pctB,
    flow: g.flow || flowRate,
  }));

  // Only show the flow overlay if flow actually changes across steps.
  // When flow is constant (the common case), the flat line and second
  // Y-axis just clutter the chart.
  const flows = data.map((g) => g.flow);
  const minFlow = Math.min(...flows);
  const maxFlow = Math.max(...flows);
  const flowVaries = maxFlow - minFlow > 0.001;
  const flowPad = Math.max((maxFlow - minFlow) * 0.5, 0.1);
  const flowDomain: [number, number] = [Math.max(0, minFlow - flowPad), maxFlow + flowPad];

  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: flowVaries ? 56 : 12, left: 0, bottom: 20 }}>
          <defs>
            <linearGradient id="gradB" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            data={data}
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v: number) => `${v.toFixed(1)}`}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            label={{ value: "Time (min)", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            yAxisId="left"
            stroke="var(--chart-1)"
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            domain={[0, 100]}
            tickFormatter={(v: number) => `${v}%`}
            width={48}
          />
          {flowVaries && (
            <YAxis
              yAxisId="right"
              orientation="right"
              stroke="var(--chart-2)"
              tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              tickFormatter={(v: number) => `${v.toFixed(2)}`}
              domain={flowDomain}
              width={48}
            />
          )}
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 11,
              fontFamily: "var(--font-mono)",
            }}
            labelFormatter={(v: number) => `${Number(v).toFixed(1)} min`}
          />
          <Area
            yAxisId="left"
            type="linear"
            dataKey="pctB"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#gradB)"
            name="%B"
            isAnimationActive={false}
            connectNulls
          />
          {flowVaries && (
            <Line
              yAxisId="right"
              type="linear"
              dataKey="flow"
              stroke="var(--chart-2)"
              strokeWidth={1.5}
              dot={false}
              name="Flow (mL/min)"
              isAnimationActive={false}
              connectNulls
            />
          )}
          <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono)" }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function EditableScanFields({
  scan,
  index,
  updateScan,
}: {
  scan: MsScan;
  index: number;
  updateScan: (index: number, patch: Partial<MsScan>) => void;
}) {
  const numField = (
    label: string,
    key: keyof MsScan,
    step = "0.1",
  ) => (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={scan[key] as number ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? null : +e.target.value;
          updateScan(index, { [key]: v } as any);
        }}
        className="mt-0.5 h-7 text-xs"
      />
    </div>
  );

  const textField = (
    label: string,
    key: keyof MsScan,
  ) => (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        value={(scan[key] as string) ?? ""}
        onChange={(e) => updateScan(index, { [key]: e.target.value || null } as any)}
        className="mt-0.5 h-7 text-xs"
      />
    </div>
  );

  const selectField = (
    label: string,
    key: keyof MsScan,
    options: string[],
  ) => (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Select
        value={(scan[key] as string) ?? ""}
        onValueChange={(v) => updateScan(index, { [key]: v } as any)}
      >
        <SelectTrigger className="mt-0.5 h-7 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
      {numField("Start time (min)", "startTimeMin")}
      {numField("End time (min)", "endTimeMin")}
      {numField("Resolution", "orbitrapResolution", "1000")}
      <div>
        <Label className="text-[10px] text-muted-foreground">Scan range low (m/z)</Label>
        <Input
          type="number"
          value={scan.scanRangeMz?.[0] ?? ""}
          onChange={(e) => {
            const lo = e.target.value === "" ? null : +e.target.value;
            const hi = scan.scanRangeMz?.[1] ?? null;
            updateScan(index, { scanRangeMz: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">Scan range high (m/z)</Label>
        <Input
          type="number"
          value={scan.scanRangeMz?.[1] ?? ""}
          onChange={(e) => {
            const hi = e.target.value === "" ? null : +e.target.value;
            const lo = scan.scanRangeMz?.[0] ?? null;
            updateScan(index, { scanRangeMz: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      {selectField("AGC target", "agcTarget", ["Standard", "High", "Low"])}
      {numField("Microscans", "microscans", "1")}
      {numField("RF lens (%)", "rfLensPct", "1")}
      {selectField("Max IT mode", "maxInjectionTimeMode", ["Auto", "Custom"])}
      {numField("Max IT (ms)", "maxInjectionTimeMs", "1")}
      {selectField("Data type", "dataType", ["Profile", "Centroid"])}
      {selectField("Polarity", "polarity", ["Both", "Positive", "Negative"])}
      {selectField("Source fragmentation", "sourceFragmentation", ["False", "True"])}
      {textField("Scan description", "scanDescription")}
      {/* ddMS2-specific */}
      {textField("Isolation offset", "isolationOffset")}
      {textField("Isolation window", "isolationWindow")}
      {numField("Isolation window (m/z)", "isolationWindowMz", "0.1")}
      {numField("Max multiplexed ions", "maxMultiplexedIons", "1")}
      {numField("Min intensity", "intensityThreshold", "100")}
      {textField("Dynamic exclusion", "dynamicExclusionMode")}
      {textField("Isotope exclusion", "isotopeExclusion")}
      <div>
        <Label className="text-[10px] text-muted-foreground">Precursor range low (m/z)</Label>
        <Input
          type="number"
          value={scan.precursorSelectionRange?.[0] ?? ""}
          onChange={(e) => {
            const lo = e.target.value === "" ? null : +e.target.value;
            const hi = scan.precursorSelectionRange?.[1] ?? null;
            updateScan(index, { precursorSelectionRange: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">Precursor range high (m/z)</Label>
        <Input
          type="number"
          value={scan.precursorSelectionRange?.[1] ?? ""}
          onChange={(e) => {
            const hi = e.target.value === "" ? null : +e.target.value;
            const lo = scan.precursorSelectionRange?.[0] ?? null;
            updateScan(index, { precursorSelectionRange: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      {textField("Reported mass", "reportedMass")}
      {textField("Scan range mode", "scanRangeMode")}
      {textField("TurboTMT", "turboTmt")}
      {selectField("Lock mass injection", "lockMassInjection", ["False", "True"])}
      {selectField("Multiplex ions", "multiplexIonsEnabled", ["False", "True"])}

      {/* Extra params */}
      {scan.extraParams && scan.extraParams.length > 0 && (
        <div className="col-span-2 sm:col-span-3">
          <details>
            <summary className="cursor-pointer text-[10px] text-muted-foreground">
              Extra parameters ({scan.extraParams.length})
            </summary>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
              {scan.extraParams.map((p, j) => (
                <div key={j} className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground shrink-0">{p.key}:</span>
                  <Input
                    value={p.value}
                    onChange={(e) => {
                      const next = [...scan.extraParams];
                      next[j] = { ...p, value: e.target.value };
                      updateScan(index, { extraParams: next });
                    }}
                    className="h-6 flex-1 text-[10px]"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={() => updateScan(index, { extraParams: scan.extraParams.filter((_, k) => k !== j) })}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}