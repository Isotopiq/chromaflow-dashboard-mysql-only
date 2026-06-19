import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import { getRunEIC } from "@/lib/lab.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { AnalyteComparePanel } from "@/components/analyte-compare-panel";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { monoisotopicMass, mzFromFormula } from "@/lib/chem";
import { ago } from "@/lib/time";
import type { Run, Column as LabColumn, Method } from "@/lib/lab-types";

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

import type { Run, Column as LabColumn, Method } from "@/lib/lab-types";
type RunLite = Run;
type ColumnLite = LabColumn;
type MethodLite = Method;

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
