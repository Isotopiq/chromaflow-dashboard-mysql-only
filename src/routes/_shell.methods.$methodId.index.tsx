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
import { ArrowLeft, GitBranch, Edit3, Trash2, Archive, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import type { Method } from "@/lib/lab-types";

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
  const { columns, runs, currentUser, removeMethodLocal, archiveMethodLocal } = useLab();
  const deleteFn = useServerFn(deleteMethod);
  const archiveFn = useServerFn(archiveMethod);
  const downloadFn = useServerFn(downloadMethodFile);
  const nav = useNavigate();
  const [showDelete, setShowDelete] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const column = columns.find((c) => c.id === method.columnId);
  const methodRuns = runs.filter((r) => r.methodId === method.id);
  const isAdmin = currentUser?.role === "admin";
  const canModify = isAdmin || !method.createdBy || method.createdBy === currentUser?.id;

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
      {method.msScans && method.msScans.length > 0 && (
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            MS Scan Definitions ({method.msScans.length})
          </div>
          <div className="mt-3 space-y-3">
            {method.msScans.map((scan, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{scan.scanType}</Badge>
                  <span className="text-sm font-medium">{scan.experimentName || `Scan ${i + 1}`}</span>
                  {scan.startTimeMin != null && scan.endTimeMin != null && (
                    <span className="text-[10px] text-muted-foreground">
                      {scan.startTimeMin}–{scan.endTimeMin} min
                    </span>
                  )}
                </div>
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
              </div>
            ))}
          </div>
        </Card>
      )}

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