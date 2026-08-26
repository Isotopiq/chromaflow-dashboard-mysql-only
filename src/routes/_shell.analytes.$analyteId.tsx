import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import { getRunEIC, getAnalyteColumnRts, setAnalyteColumnRt, deleteAnalyteColumnRt } from "@/lib/lab.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { AnalyteComparePanel } from "@/components/analyte-compare-panel";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { monoisotopicMass, mzFromFormula } from "@/lib/chem";
import { ago } from "@/lib/time";
import { toast } from "sonner";
import type { Run, Column as LabColumn, Method, AnalyteColumnRt } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/analytes/$analyteId")({
  component: AnalyteDetail,
});

function AnalyteDetail() {
  const { analyteId } = Route.useParams();
  const { analytes, runs, columns, methods } = useLab();
  const analyte = analytes.find((a) => a.id === analyteId);

  const matchingRuns = useMemo(
    () =>
      analyte
        ? runs.filter((r) =>
            r.peaks.some(
              (p) => p.analyteId === analyte.id || p.analyteName === analyte.name,
            ),
          )
        : [],
    [runs, analyte],
  );
  const columnsSeen = useMemo(() => {
    const set = new Set<string>();
    for (const r of matchingRuns) if (r.columnId) set.add(r.columnId);
    return Array.from(set)
      .map((id) => columns.find((c) => c.id === id))
      .filter(Boolean) as typeof columns;
  }, [matchingRuns, columns]);

  if (!analyte) {
    return (
      <div className="p-6">
        <Link to="/analytes" className="text-xs text-primary hover:underline">
          ← Back to library
        </Link>
        <Card className="mt-4 border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Compound not found.
        </Card>
      </div>
    );
  }

  const mass = analyte.formula ? monoisotopicMass(analyte.formula) : null;
  const mzPos = analyte.formula ? mzFromFormula(analyte.formula, "[M+H]+") : null;
  const targetMz = mzPos ?? analyte.mz;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <Link
          to="/analytes"
          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Compound library
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{analyte.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
              {analyte.formula && <span>{analyte.formula}</span>}
              {mass != null && <span>· mass {mass.toFixed(4)}</span>}
              <span>· [M+H]⁺ {targetMz.toFixed(4)}</span>
              <span>· expected RT {analyte.rtExpected.toFixed(2)} min</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px]">
              Seen on {columnsSeen.length} {columnsSeen.length === 1 ? "column" : "columns"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {matchingRuns.length} annotated {matchingRuns.length === 1 ? "run" : "runs"}
            </Badge>
            {columnsSeen.slice(0, 4).map((c) => (
              <Badge key={c.id} variant="secondary" className="text-[10px]">
                {c.name}
              </Badge>
            ))}
            {columnsSeen.length > 4 && (
              <Badge variant="secondary" className="text-[10px]">
                +{columnsSeen.length - 4}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {matchingRuns.length > 0 && (
        <AnalyteComparePanel
          lockedAnalyteId={analyte.id}
          defaultGroupBy="column"
          hideAnalytePicker
          preferAnnotatedRuns
        />
      )}

      <ColumnRtManager analyteId={analyte.id} defaultRt={analyte.rtExpected} />

      <AllRunsXICGrid
        analyteName={analyte.name}
        mz={targetMz}
        runs={runs}
        columns={columns}
        methods={methods}
      />
    </div>
  );
}

type RunLite = Run;
type ColumnLite = LabColumn;
type MethodLite = Method;

// ---------------------------------------------------------------------------
// Per-column RT manager
// ---------------------------------------------------------------------------

function ColumnRtManager({ analyteId, defaultRt }: { analyteId: string; defaultRt: number }) {
  const { columns } = useLab();
  const qc = useQueryClient();
  const getFn = useServerFn(getAnalyteColumnRts);
  const setFn = useServerFn(setAnalyteColumnRt);
  const deleteFn = useServerFn(deleteAnalyteColumnRt);

  const [rts, setRts] = useState<AnalyteColumnRt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedColumnId, setSelectedColumnId] = useState<string>("");
  const [rtValue, setRtValue] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // Load per-column RTs on mount.
  useMemo(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getFn({ data: { analyteId } });
        if (!cancelled) setRts(data as AnalyteColumnRt[]);
      } catch (e) {
        console.error("Failed to load column RTs", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [analyteId]);

  const usedColumnIds = new Set(rts.map((r) => r.columnId));
  const availableColumns = columns.filter((c) => !usedColumnIds.has(c.id));

  async function handleAdd() {
    if (!selectedColumnId) {
      toast.error("Select a column first.");
      return;
    }
    const rt = parseFloat(rtValue);
    if (!Number.isFinite(rt) || rt < 0 || rt > 120) {
      toast.error("RT must be 0–120 min.");
      return;
    }
    setSaving(true);
    try {
      await setFn({ data: { analyteId, columnId: selectedColumnId, rtExpected: rt, notes } });
      const updated = await getFn({ data: { analyteId } });
      setRts(updated as AnalyteColumnRt[]);
      setSelectedColumnId("");
      setRtValue("");
      setNotes("");
      qc.invalidateQueries({ queryKey: ["lab"] });
      toast.success("Column RT saved.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save column RT.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteFn({ data: { id } });
      setRts((prev) => prev.filter((r) => r.id !== id));
      qc.invalidateQueries({ queryKey: ["lab"] });
      toast.success("Column RT removed.");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete column RT.");
    }
  }

  async function handleUpdateRt(r: AnalyteColumnRt, newRt: string) {
    const rt = parseFloat(newRt);
    if (!Number.isFinite(rt) || rt < 0 || rt > 120) return;
    try {
      await setFn({ data: { analyteId: r.analyteId, columnId: r.columnId, rtExpected: rt, notes: r.notes } });
      setRts((prev) => prev.map((x) => x.id === r.id ? { ...x, rtExpected: rt } : x));
      qc.invalidateQueries({ queryKey: ["lab"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to update RT.");
    }
  }

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Per-column retention time
          </div>
          <div className="mt-1 text-sm font-medium">
            Default RT: <span className="font-mono">{defaultRt.toFixed(2)} min</span>
            {rts.length > 0 && (
              <span className="ml-2 text-muted-foreground">
                · {rts.length} column override{rts.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Existing overrides */}
      {loading ? (
        <div className="mt-3 text-xs text-muted-foreground">Loading…</div>
      ) : rts.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No per-column RT overrides yet. The default RT ({defaultRt.toFixed(2)} min) is used for all columns.
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 text-left font-medium">Column</th>
                <th className="pb-2 text-left font-medium">RT (min)</th>
                <th className="pb-2 text-left font-medium">Notes</th>
                <th className="pb-2 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rts.map((r) => (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="py-2 font-medium">{r.columnName}</td>
                  <td className="py-2">
                    <Input
                      className="h-7 w-24 font-mono text-xs"
                      defaultValue={r.rtExpected.toFixed(2)}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && parseFloat(v) !== r.rtExpected) handleUpdateRt(r, v);
                      }}
                    />
                  </td>
                  <td className="py-2 text-muted-foreground">{r.notes || "—"}</td>
                  <td className="py-2 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add new override */}
      {availableColumns.length > 0 && (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Column</Label>
            <Select value={selectedColumnId} onValueChange={setSelectedColumnId}>
              <SelectTrigger className="h-8 w-48 text-xs">
                <SelectValue placeholder="Select column…" />
              </SelectTrigger>
              <SelectContent>
                {availableColumns.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">RT (min)</Label>
            <Input
              className="h-8 w-24 font-mono text-xs"
              value={rtValue}
              onChange={(e) => setRtValue(e.target.value)}
              placeholder={defaultRt.toFixed(2)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Notes</Label>
            <Input
              className="h-8 w-40 text-xs"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
            />
          </div>
          <Button size="sm" className="h-8" disabled={saving || !selectedColumnId} onClick={handleAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add
          </Button>
        </div>
      )}
    </Card>
  );
}

function AllRunsXICGrid({
  analyteName,
  mz,
  runs,
  columns,
  methods,
}: {
  analyteName: string;
  mz: number;
  runs: RunLite[];
  columns: ColumnLite[];
  methods: MethodLite[];
}) {
  const eicFn = useServerFn(getRunEIC);
  const ppm = 10;

  const ordered = useMemo(
    () =>
      [...runs]
        .filter((r) => !!r.scansBlobPath)
        .sort((a, b) => +new Date(b.acquiredAt) - +new Date(a.acquiredAt)),
    [runs],
  );

  const queries = useQueries({
    queries: ordered.map((r) => ({
      queryKey: ["analyte-eic", r.id, mz.toFixed(4), ppm],
      queryFn: () => eicFn({ data: { runId: r.id, mz, ppm } }),
      staleTime: 5 * 60 * 1000,
      retry: false,
    })),
  });

  if (runs.length === 0) {
    return (
      <Card className="border-border bg-card p-8 text-center">
        <div className="text-sm font-medium">No runs yet</div>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Upload runs to see extracted ion chromatograms for {analyteName} here.
        </p>
        <div className="mt-4">
          <Button asChild size="sm" variant="outline">
            <Link to="/runs">Browse runs</Link>
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Saved XIC chromatograms
          </div>
          <div className="mt-1 text-sm font-medium">
            {analyteName} · m/z {mz.toFixed(4)} ± {ppm} ppm · {ordered.length} run
            {ordered.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {ordered.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No runs have saved scan data for EIC extraction. Re-upload an mzML to enable XIC traces.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ordered.map((r, i) => {
            const q = queries[i];
            const col = columns.find((c) => c.id === r.columnId);
            const meth = methods.find((m) => m.id === r.methodId);
            return (
              <div key={r.id} className="rounded-md border border-border bg-surface-elevated p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/runs/$runId"
                      params={{ runId: r.id }}
                      className="block truncate font-mono text-xs hover:text-primary"
                      title={r.name}
                    >
                      {r.name}
                    </Link>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {ago(r.acquiredAt)}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-0.5">
                    {col && (
                      <Badge variant="outline" className="text-[9px]">
                        {col.name}
                      </Badge>
                    )}
                    {meth && (
                      <Badge variant="secondary" className="text-[9px]">
                        {meth.name}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="mt-2">
                  {q.isLoading ? (
                    <div className="flex h-[140px] items-center justify-center text-[11px] text-muted-foreground">
                      Extracting EIC…
                    </div>
                  ) : q.isError ? (
                    <div className="flex h-[140px] items-center justify-center px-2 text-center text-[10px] text-muted-foreground">
                      {(q.error as Error)?.message ?? "EIC failed"}
                    </div>
                  ) : q.data ? (
                    <ChromatogramPlot
                      compact
                      height={140}
                      runs={[
                        {
                          id: r.id,
                          name: r.name,
                          trace: { x: q.data.x, tic: q.data.y, bpc: q.data.y },
                        },
                      ]}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
