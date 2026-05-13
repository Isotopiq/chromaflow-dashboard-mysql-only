import { createFileRoute } from "@tanstack/react-router";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ZAxis,
} from "recharts";

export const Route = createFileRoute("/_shell/analytes")({
  component: Analytes,
});

function Analytes() {
  const { analytes, runs, methods } = useLab();
  const [selected, setSelected] = useState<string[]>(analytes.slice(0, 5).map((a) => a.id));

  // Build matrix: rows = analytes, cols = methods, value = mean RT (from peaks matched by name)
  const matrix = useMemo(() => {
    return selected.map((aid) => {
      const a = analytes.find((x) => x.id === aid)!;
      const cells = methods.map((m) => {
        const methodRuns = runs.filter((r) => r.methodId === m.id);
        const peaks = methodRuns.flatMap((r) => r.peaks).filter((p) => p.analyteName === a.name);
        const meanRt = peaks.length
          ? peaks.reduce((s, p) => s + p.rt, 0) / peaks.length
          : null;
        const meanArea = peaks.length
          ? peaks.reduce((s, p) => s + p.area, 0) / peaks.length
          : null;
        return { methodId: m.id, methodName: m.name, meanRt, meanArea, count: peaks.length };
      });
      return { analyte: a, cells };
    });
  }, [selected, analytes, runs, methods]);

  // Heatmap intensity scale
  const allAreas = matrix.flatMap((r) => r.cells.map((c) => c.meanArea ?? 0));
  const maxArea = Math.max(...allAreas, 1);

  // Scatter: x = expected RT, y = observed RT, size = area
  const scatterData = matrix.flatMap((r) =>
    r.cells
      .filter((c) => c.meanRt !== null)
      .map((c) => ({
        name: r.analyte.name,
        method: c.methodName,
        x: r.analyte.rtExpected,
        y: c.meanRt!,
        z: Math.log10((c.meanArea ?? 1) + 1),
      })),
  );

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Analyte comparison
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Analyte matrix</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          See how each analyte behaves across methods — retention drift, recovery, missing detections.
        </p>
      </div>

      <Card className="border-border bg-card p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Pick analytes
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {analytes.map((a) => {
            const checked = selected.includes(a.id);
            return (
              <label
                key={a.id}
                className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                  checked ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) =>
                    setSelected(v ? [...selected, a.id] : selected.filter((x) => x !== a.id))
                  }
                />
                {a.name}
              </label>
            );
          })}
        </div>
      </Card>

      <Card className="border-border bg-card p-0">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Mean RT per method (heatmap on area)
          </div>
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[10px] uppercase tracking-wider">Analyte</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Expected RT</TableHead>
                {methods.map((m) => (
                  <TableHead key={m.id} className="text-[10px] uppercase tracking-wider">
                    {m.name}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.map((row) => (
                <TableRow key={row.analyte.id} className="text-xs">
                  <TableCell className="font-medium">{row.analyte.name}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">
                    {row.analyte.rtExpected.toFixed(2)}
                  </TableCell>
                  {row.cells.map((c) => {
                    const intensity = c.meanArea ? c.meanArea / maxArea : 0;
                    return (
                      <TableCell
                        key={c.methodId}
                        style={{
                          background: c.meanRt
                            ? `color-mix(in oklab, var(--chart-1) ${20 + intensity * 60}%, transparent)`
                            : "transparent",
                        }}
                      >
                        {c.meanRt ? (
                          <div className="font-mono">
                            <div>{c.meanRt.toFixed(2)}</div>
                            <div className="text-[9px] text-muted-foreground">
                              n={c.count}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Expected vs observed RT
        </div>
        <div className="mt-3 h-80">
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 24, left: 8 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" />
              <XAxis
                dataKey="x"
                type="number"
                name="Expected RT"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                label={{
                  value: "Expected RT (min)",
                  position: "insideBottom",
                  offset: -10,
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
              />
              <YAxis
                dataKey="y"
                type="number"
                name="Observed RT"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                label={{
                  value: "Observed RT (min)",
                  angle: -90,
                  position: "insideLeft",
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
              />
              <ZAxis dataKey="z" range={[40, 240]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(v: number) => v.toFixed(2)}
              />
              <Scatter data={scatterData} fill="var(--chart-1)" />
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <Badge variant="outline">Bubble size ∝ log(area)</Badge>
        </div>
      </Card>
    </div>
  );
}
