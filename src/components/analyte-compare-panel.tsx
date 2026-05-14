import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import { getRunEIC } from "@/lib/lab.functions";
import { integrateBand } from "@/lib/peak-math";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { ago } from "@/lib/mock-data";

const MAX_RUNS = 6;

type GroupBy = "column" | "method";

export function AnalyteComparePanel() {
  const { analytes, runs, columns, methods } = useLab();
  const [analyteId, setAnalyteId] = useState<string>(analytes[0]?.id ?? "");
  const [groupBy, setGroupBy] = useState<GroupBy>("column");
  const [ppm, setPpm] = useState<number>(10);

  const analyte = analytes.find((a) => a.id === analyteId);

  // Auto-suggest: most recent run per group key.
  const initialRunIds = useMemo(() => {
    const sorted = [...runs].sort(
      (a, b) => +new Date(b.acquiredAt) - +new Date(a.acquiredAt),
    );
    const seen = new Set<string>();
    const picked: string[] = [];
    for (const r of sorted) {
      const key = groupBy === "column" ? r.columnId : r.methodId;
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(r.id);
      if (picked.length >= MAX_RUNS) break;
    }
    return picked;
  }, [runs, groupBy]);

  const [runIds, setRunIds] = useState<string[]>(initialRunIds);

  // Re-seed when group axis flips and user hasn't customized much.
  const effectiveRunIds = runIds.length === 0 ? initialRunIds : runIds;

  const fetchEIC = useServerFn(getRunEIC);
  const queries = useQueries({
    queries: effectiveRunIds.map((id) => {
      const run = runs.find((r) => r.id === id);
      const mz = analyte?.mz ?? 0;
      return {
        queryKey: ["analyte-eic", id, mz, ppm],
        enabled: !!run && !!analyte,
        queryFn: async () => {
          if (!run) return null;
          if (run.scansBlobPath) {
            return await fetchEIC({ data: { runId: id, mz, ppm } });
          }
          // Fallback: use TIC trace as a stand-in so synthetic/seed runs still plot.
          return {
            x: run.trace.x,
            y: run.trace.tic,
            mz,
            ppm,
            mzLow: 0,
            mzHigh: 0,
            fallback: true as const,
          };
        },
      };
    }),
  });

  const plotRuns = effectiveRunIds.map((id, i) => {
    const run = runs.find((r) => r.id === id)!;
    const q = queries[i];
    const data = q.data;
    return {
      id,
      name: run.name,
      trace: data
        ? { x: data.x, tic: data.y, bpc: data.y }
        : run.trace,
    };
  });

  const rows = effectiveRunIds.map((id, i) => {
    const run = runs.find((r) => r.id === id)!;
    const col = columns.find((c) => c.id === run.columnId);
    const method = methods.find((m) => m.id === run.methodId);
    const q = queries[i];
    const data = q.data;
    const fallback = (data as any)?.fallback === true;

    let metrics: ReturnType<typeof integrateBand> | null = null;
    let annotated = false;

    if (data && data.x.length > 1) {
      // Find apex
      let apex = 0;
      let apexIdx = 0;
      for (let k = 0; k < data.y.length; k++) {
        if (data.y[k] > apex) {
          apex = data.y[k];
          apexIdx = k;
        }
      }
      const apexRt = data.x[apexIdx];
      const expected = analyte?.rtExpected ?? apexRt;
      // Constrain apex to within ±1 min of expected for fallback (TIC) traces.
      const useApex = fallback
        ? Math.abs(apexRt - expected) <= 1.5
          ? apexRt
          : expected
        : apexRt;
      const half = 0.4;
      metrics = integrateBand(
        data.x,
        data.y,
        useApex - half,
        useApex + half,
      );
    }

    if (!metrics && analyte) {
      const annot = run.peaks.find(
        (p) => p.analyteId === analyte.id || p.analyteName === analyte.name,
      );
      if (annot) {
        annotated = true;
        metrics = {
          rtStart: annot.rt - annot.fwhm,
          rtEnd: annot.rt + annot.fwhm,
          apexRt: annot.rt,
          height: annot.height,
          area: annot.area,
          fwhm: annot.fwhm,
          sn: annot.sn,
          baselineLeft: 0,
          baselineRight: 0,
        };
      }
    }

    return { run, col, method, q, metrics, fallback, annotated };
  });

  // Group summary
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; rts: number[]; areas: number[] }
    >();
    for (const r of rows) {
      if (!r.metrics) continue;
      const key = groupBy === "column" ? r.run.columnId : r.run.methodId;
      const label =
        groupBy === "column"
          ? (r.col?.name ?? "Unknown column")
          : (r.method?.name ?? "Unknown method");
      const g = map.get(key) ?? { label, rts: [], areas: [] };
      g.rts.push(r.metrics.apexRt);
      g.areas.push(r.metrics.area);
      map.set(key, g);
    }
    return Array.from(map.values()).map((g) => {
      const meanRt = g.rts.reduce((s, v) => s + v, 0) / g.rts.length;
      const spread =
        g.rts.length > 1
          ? Math.max(...g.rts) - Math.min(...g.rts)
          : 0;
      const meanArea = g.areas.reduce((s, v) => s + v, 0) / g.areas.length;
      return { label: g.label, n: g.rts.length, meanRt, spread, meanArea };
    });
  }, [rows, groupBy]);

  const toggleRun = (id: string, on: boolean) => {
    setRunIds((cur) => {
      const base = cur.length === 0 ? initialRunIds : cur;
      if (on) {
        if (base.includes(id)) return base;
        if (base.length >= MAX_RUNS) return base;
        return [...base, id];
      }
      return base.filter((x) => x !== id);
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card className="border-border bg-card p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Analyte
        </div>
        <Select value={analyteId} onValueChange={setAnalyteId}>
          <SelectTrigger className="mt-2 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {analytes.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name} · {a.mz.toFixed(4)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Group by
            </div>
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="mt-1 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="column">Column</SelectItem>
                <SelectItem value="method">Method</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              ppm
            </div>
            <Input
              type="number"
              min={1}
              max={200}
              value={ppm}
              onChange={(e) => setPpm(Math.max(1, Math.min(200, Number(e.target.value) || 10)))}
              className="mt-1 h-8 text-xs font-mono"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Runs ({effectiveRunIds.length}/{MAX_RUNS})
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => setRunIds(initialRunIds)}
          >
            Reset
          </Button>
        </div>
        <div className="mt-1 max-h-[420px] space-y-1 overflow-y-auto pr-1">
          {runs.map((r) => {
            const checked = effectiveRunIds.includes(r.id);
            const col = columns.find((c) => c.id === r.columnId);
            const method = methods.find((m) => m.id === r.methodId);
            const disabled = !checked && effectiveRunIds.length >= MAX_RUNS;
            return (
              <label
                key={r.id}
                className={`flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-xs hover:bg-accent/30 ${disabled ? "opacity-50" : ""}`}
              >
                <Checkbox
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={(v) => toggleRun(r.id, !!v)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono">{r.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {col?.name ?? "—"} · {method?.name ?? "—"} · {ago(r.acquiredAt)}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card className="border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                EIC overlay
              </div>
              <h2 className="text-sm font-semibold">
                {analyte
                  ? `${analyte.name} · m/z ${analyte.mz.toFixed(4)} ±${ppm} ppm`
                  : "Pick an analyte"}
              </h2>
              {analyte && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  Expected RT {analyte.rtExpected.toFixed(2)} min · grouped by {groupBy}
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-1">
              {groups.map((g) => (
                <Badge key={g.label} variant="outline" className="text-[10px]">
                  {g.label} · n={g.n} · RT {g.meanRt.toFixed(2)}
                  {g.spread > 0 ? ` ±${g.spread.toFixed(2)}` : ""}
                </Badge>
              ))}
            </div>
          </div>
          <div className="mt-3">
            {effectiveRunIds.length === 0 ? (
              <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
                Select runs from the left.
              </div>
            ) : queries.some((q) => q.isLoading) ? (
              <div className="flex h-[360px] items-center justify-center text-xs text-muted-foreground">
                Extracting EIC traces…
              </div>
            ) : (
              <ChromatogramPlot runs={plotRuns} channel="tic" height={360} />
            )}
          </div>
        </Card>

        <Card className="border-border bg-card p-0">
          <div className="border-b border-border p-3">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Per-run metrics
            </div>
            <div className="text-xs text-muted-foreground">
              EIC integration around the apex (±0.4 min). Fallback uses TIC trace + annotated peaks for runs without raw scans.
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[10px] uppercase tracking-wider">Run</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Column</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Method</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">RT</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">ΔRT</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Height</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Area</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">FWHM</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">S/N</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ run, col, method, metrics, fallback, annotated }) => {
                const dRt =
                  metrics && analyte
                    ? metrics.apexRt - analyte.rtExpected
                    : null;
                return (
                  <TableRow key={run.id} className="text-xs">
                    <TableCell className="font-mono">{run.name}</TableCell>
                    <TableCell className="text-muted-foreground">{col?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{method?.name ?? "—"}</TableCell>
                    <TableCell className="font-mono">
                      {metrics ? metrics.apexRt.toFixed(2) : "—"}
                    </TableCell>
                    <TableCell
                      className={`font-mono ${
                        dRt != null && Math.abs(dRt) > 0.3
                          ? "text-[color:var(--status-warn)]"
                          : ""
                      }`}
                    >
                      {dRt != null
                        ? `${dRt >= 0 ? "+" : ""}${dRt.toFixed(2)}`
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {metrics ? formatSci(metrics.height) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {metrics ? formatSci(metrics.area) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {metrics ? metrics.fwhm.toFixed(3) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {metrics ? metrics.sn.toFixed(1) : "—"}
                    </TableCell>
                    <TableCell>
                      {annotated ? (
                        <Badge variant="outline" className="text-[10px]">peak</Badge>
                      ) : fallback ? (
                        <Badge variant="outline" className="text-[10px]">TIC</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">EIC</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="p-6 text-center text-xs text-muted-foreground">
                    No runs selected.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

function formatSci(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}
