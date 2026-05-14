import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { AnalyteComparePanel } from "@/components/analyte-compare-panel";
import { monoisotopicMass, mzFromFormula } from "@/lib/chem";

export const Route = createFileRoute("/_shell/analytes/$analyteId")({
  component: AnalyteDetail,
});

function AnalyteDetail() {
  const { analyteId } = Route.useParams();
  const { analytes, runs, columns } = useLab();
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
              <span>· [M+H]⁺ {(mzPos ?? analyte.mz).toFixed(4)}</span>
              <span>· expected RT {analyte.rtExpected.toFixed(2)} min</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px]">
              Seen on {columnsSeen.length} {columnsSeen.length === 1 ? "column" : "columns"}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {matchingRuns.length} {matchingRuns.length === 1 ? "run" : "runs"}
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

      {matchingRuns.length === 0 ? (
        <Card className="border-border bg-card p-8 text-center">
          <div className="text-sm font-medium">No recordings yet</div>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            This compound hasn't been annotated on any run. Once a peak is labelled
            with {analyte.name}, it will appear here grouped by column and method.
          </p>
          <div className="mt-4">
            <Button asChild size="sm" variant="outline">
              <Link to="/runs">Browse runs</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <AnalyteComparePanel
          lockedAnalyteId={analyte.id}
          defaultGroupBy="column"
          hideAnalytePicker
          preferAnnotatedRuns
        />
      )}
    </div>
  );
}
