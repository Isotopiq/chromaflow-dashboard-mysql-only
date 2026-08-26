import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Plus, FlaskConical, TrendingUp, CheckCircle2, XCircle, Download } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  ReferenceLine,
} from "recharts";
import {
  listCalibrationCurves,
  getCalibrationCurve,
  linkCalibrationStandard,
  toggleStandardExcluded,
  deleteCalibrationStandard,
  fitCalibrationCurve,
  deleteCalibrationCurve,
  addQCSample,
  deleteQCSample,
  calculateConcentrations,
  listStandardsForAnalyte,
} from "@/lib/quant.functions";
import { downloadCsv } from "@/lib/exports";

export const Route = createFileRoute("/_shell/quant")({
  component: Quantitation,
});

function Quantitation() {
  const { analytes, runs, methods, batches } = useLab();
  const [tab, setTab] = useState("curves");

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Quantitation
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Calibration & QC</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Build calibration curves from known standards, back-calculate concentrations, and track QC sample accuracy.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="curves">Calibration curves</TabsTrigger>
          <TabsTrigger value="standards">Standards</TabsTrigger>
          <TabsTrigger value="qc">QC samples</TabsTrigger>
        </TabsList>

        <TabsContent value="curves" className="mt-4">
          <CurvesTab analytes={analytes} methods={methods} batches={batches} />
        </TabsContent>
        <TabsContent value="standards" className="mt-4">
          <StandardsTab analytes={analytes} runs={runs} />
        </TabsContent>
        <TabsContent value="qc" className="mt-4">
          <QCTab analytes={analytes} runs={runs} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Curves Tab ----
function CurvesTab({ analytes, methods, batches }: { analytes: any[]; methods: any[]; batches: any[] }) {
  const listFn = useServerFn(listCalibrationCurves);
  const getFn = useServerFn(getCalibrationCurve);
  const fitFn = useServerFn(fitCalibrationCurve);
  const deleteFn = useServerFn(deleteCalibrationCurve);
  const calcFn = useServerFn(calculateConcentrations);
  const qc = useQueryClient();

  const { data: curves, refetch } = useQuery({
    queryKey: ["cal-curves"],
    queryFn: () => listFn(),
  });

  const [selectedCurveId, setSelectedCurveId] = useState<string>("");
  const [analyteId, setAnalyteId] = useState("");
  const [weighting, setWeighting] = useState("none");
  const [fitting, setFitting] = useState(false);

  const { data: curveDetail } = useQuery({
    queryKey: ["cal-curve", selectedCurveId],
    queryFn: () => getFn({ data: { id: selectedCurveId } }),
    enabled: !!selectedCurveId,
  });

  const handleFit = async () => {
    if (!analyteId) {
      toast.error("Select an analyte first");
      return;
    }
    setFitting(true);
    try {
      const curve = await fitFn({
        data: {
          analyteId,
          weighting: weighting as any,
          name: `${analytes.find((a) => a.id === analyteId)?.name ?? ""} — ${new Date().toLocaleDateString()}`,
        },
      });
      toast.success(`Curve fitted: R² = ${curve.rSquared?.toFixed(4)}`);
      setSelectedCurveId(curve.id);
      refetch();
      qc.invalidateQueries({ queryKey: ["cal-curves"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to fit curve");
    } finally {
      setFitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFn({ data: { id } });
      toast.success("Curve deleted");
      if (selectedCurveId === id) setSelectedCurveId("");
      refetch();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete curve");
    }
  };

  // Chart data for selected curve
  const chartData = useMemo(() => {
    if (!curveDetail?.standards) return [];
    return curveDetail.standards
      .filter((s: any) => !s.excluded && s.response != null)
      .map((s: any) => ({
        x: s.concentration,
        y: s.response,
      }));
  }, [curveDetail]);

  const curveLine = useMemo(() => {
    if (!curveDetail?.curve?.slope || !curveDetail?.curve?.intercept) return [];
    const points = chartData;
    if (points.length < 2) return [];
    const minX = Math.min(...points.map((p: any) => p.x));
    const maxX = Math.max(...points.map((p: any) => p.x));
    return [
      { x: minX, y: curveDetail.curve.slope * minX + curveDetail.curve.intercept },
      { x: maxX, y: curveDetail.curve.slope * maxX + curveDetail.curve.intercept },
    ];
  }, [curveDetail, chartData]);

  return (
    <div className="flex flex-col gap-4">
      {/* Fit new curve */}
      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Fit new calibration curve
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Analyte</Label>
            <Select value={analyteId} onValueChange={setAnalyteId}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Select analyte…" />
              </SelectTrigger>
              <SelectContent>
                {analytes.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Weighting</Label>
            <Select value={weighting} onValueChange={setWeighting}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none" className="text-xs">None</SelectItem>
                <SelectItem value="1/x" className="text-xs">1/x</SelectItem>
                <SelectItem value="1/x2" className="text-xs">1/x²</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={fitting || !analyteId} onClick={handleFit}>
            <TrendingUp className="mr-1 h-3.5 w-3.5" />
            {fitting ? "Fitting…" : "Fit curve"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Requires at least 2 non-excluded standards with response values. Add standards in the Standards tab first.
        </p>
      </Card>

      {/* Curves list */}
      <Card className="border-border bg-card p-0">
        <div className="border-b border-border px-4 py-2 text-xs font-semibold">
          Saved curves ({curves?.length ?? 0})
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase">Analyte</TableHead>
              <TableHead className="text-[10px] uppercase">Weighting</TableHead>
              <TableHead className="text-[10px] uppercase">Slope</TableHead>
              <TableHead className="text-[10px] uppercase">Intercept</TableHead>
              <TableHead className="text-[10px] uppercase">R²</TableHead>
              <TableHead className="text-[10px] uppercase">LOD</TableHead>
              <TableHead className="text-[10px] uppercase">LOQ</TableHead>
              <TableHead className="text-[10px] uppercase">Range</TableHead>
              <TableHead className="w-20 text-[10px] uppercase">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(curves ?? []).map((c: any) => (
              <TableRow
                key={c.id}
                className={`cursor-pointer text-xs ${selectedCurveId === c.id ? "bg-accent/20" : ""}`}
                onClick={() => setSelectedCurveId(c.id)}
              >
                <TableCell className="font-medium">{c.analyteName}</TableCell>
                <TableCell className="font-mono text-[11px]">{c.weighting}</TableCell>
                <TableCell className="font-mono text-[11px]">{c.slope?.toExponential(3) ?? "—"}</TableCell>
                <TableCell className="font-mono text-[11px]">{c.intercept?.toExponential(3) ?? "—"}</TableCell>
                <TableCell className="font-mono text-[11px]">
                  <span className={c.rSquared < 0.99 ? "text-amber-500" : "text-green-500"}>
                    {c.rSquared?.toFixed(4) ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-[11px]">{c.lod?.toFixed(3) ?? "—"}</TableCell>
                <TableCell className="font-mono text-[11px]">{c.loq?.toFixed(3) ?? "—"}</TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">
                  {c.rangeLow?.toFixed(2)}–{c.rangeHigh?.toFixed(2)}
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={(e) => { e.stopPropagation(); handleDelete(c.id); }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {(!curves || curves.length === 0) && (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-xs text-muted-foreground">
                  No calibration curves yet. Fit one above.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Curve detail with chart */}
      {curveDetail?.curve && (
        <Card className="border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Curve detail
              </div>
              <h2 className="text-sm font-semibold">
                {curveDetail.curve.analyteName} — R² = {curveDetail.curve.rSquared?.toFixed(4)}
              </h2>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const data = curveDetail.standards.map((s: any) => ({
                  concentration: s.concentration,
                  response: s.response ?? "",
                  excluded: s.excluded,
                  unit: s.concentrationUnit,
                }));
                downloadCsv(`calibration-${curveDetail.curve.analyteName}`, data);
              }}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>
          {chartData.length > 0 && (
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Concentration"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    label={{ value: "Concentration", position: "bottom", fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Response"
                    stroke="var(--muted-foreground)"
                    fontSize={11}
                    label={{ value: "Response", angle: -90, position: "insideLeft", fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      fontSize: 12,
                    }}
                  />
                  <Scatter data={chartData} fill="var(--primary)" />
                  {curveLine.length === 2 && (
                    <Line
                      data={curveLine}
                      dataKey="y"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ---- Standards Tab ----
function StandardsTab({ analytes, runs }: { analytes: any[]; runs: any[] }) {
  const listFn = useServerFn(listStandardsForAnalyte);
  const linkFn = useServerFn(linkCalibrationStandard);
  const toggleFn = useServerFn(toggleStandardExcluded);
  const deleteFn = useServerFn(deleteCalibrationStandard);
  const qc = useQueryClient();

  const [analyteId, setAnalyteId] = useState("");
  const [runId, setRunId] = useState("");
  const [concentration, setConcentration] = useState("");
  const [unit, setUnit] = useState("ng/mL");
  const [adding, setAdding] = useState(false);

  const { data: standards, refetch } = useQuery({
    queryKey: ["cal-standards", analyteId],
    queryFn: () => listFn({ data: { analyteId } }),
    enabled: !!analyteId,
  });

  const selectedRun = runs.find((r) => r.id === runId);
  const runPeaks = selectedRun?.peaks ?? [];

  const handleAdd = async () => {
    if (!analyteId || !runId || !concentration) {
      toast.error("Fill in analyte, run, and concentration");
      return;
    }
    setAdding(true);
    try {
      // Try to auto-match a peak by analyte
      const matchedPeak = runPeaks.find((p: any) => p.analyteId === analyteId);
      await linkFn({
        data: {
          analyteId,
          runId,
          peakId: matchedPeak?.id ?? null,
          concentration: parseFloat(concentration),
          concentrationUnit: unit,
        },
      });
      toast.success("Standard added");
      setConcentration("");
      refetch();
      qc.invalidateQueries({ queryKey: ["cal-standards", analyteId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to add standard");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Add calibration standard
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Analyte</Label>
            <Select value={analyteId} onValueChange={(v) => { setAnalyteId(v); }}>
              <SelectTrigger className="w-48 h-8 text-xs">
                <SelectValue placeholder="Select analyte…" />
              </SelectTrigger>
              <SelectContent>
                {analytes.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">{a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Run</Label>
            <Select value={runId} onValueChange={setRunId}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue placeholder="Select run…" />
              </SelectTrigger>
              <SelectContent>
                {runs.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Concentration</Label>
            <Input
              type="number"
              value={concentration}
              onChange={(e) => setConcentration(e.target.value)}
              className="h-8 w-28 text-xs"
              placeholder="e.g. 10"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Unit</Label>
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="h-8 w-24 text-xs"
            />
          </div>
          <Button size="sm" disabled={adding} onClick={handleAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {adding ? "Adding…" : "Add standard"}
          </Button>
        </div>
      </Card>

      {analyteId && (
        <Card className="border-border bg-card p-0">
          <div className="border-b border-border px-4 py-2 text-xs font-semibold">
            Standards for {analytes.find((a) => a.id === analyteId)?.name ?? "analyte"} ({standards?.length ?? 0})
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[10px] uppercase">Conc.</TableHead>
                <TableHead className="text-[10px] uppercase">Unit</TableHead>
                <TableHead className="text-[10px] uppercase">Response</TableHead>
                <TableHead className="text-[10px] uppercase">Type</TableHead>
                <TableHead className="text-[10px] uppercase">Run</TableHead>
                <TableHead className="text-[10px] uppercase">Excluded</TableHead>
                <TableHead className="w-20 text-[10px] uppercase">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(standards ?? []).map((s: any) => (
                <TableRow key={s.id} className="text-xs">
                  <TableCell className="font-mono">{s.concentration}</TableCell>
                  <TableCell className="text-muted-foreground">{s.concentrationUnit}</TableCell>
                  <TableCell className="font-mono">{s.response?.toExponential(3) ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{s.responseType}</TableCell>
                  <TableCell className="truncate text-muted-foreground">{s.runId.slice(0, 8)}…</TableCell>
                  <TableCell>
                    <Checkbox
                      checked={s.excluded}
                      onCheckedChange={(v) => {
                        toggleFn({ data: { id: s.id, excluded: v === true } });
                        refetch();
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => {
                        deleteFn({ data: { id: s.id } });
                        refetch();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!standards || standards.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-xs text-muted-foreground">
                    No standards yet. Add one above.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

// ---- QC Tab ----
function QCTab({ analytes, runs }: { analytes: any[]; runs: any[] }) {
  const listCurvesFn = useServerFn(listCalibrationCurves);
  const getCurveFn = useServerFn(getCalibrationCurve);
  const addQcFn = useServerFn(addQCSample);
  const deleteQcFn = useServerFn(deleteQCSample);
  const qc = useQueryClient();

  const { data: curves } = useQuery({
    queryKey: ["cal-curves"],
    queryFn: () => listCurvesFn(),
  });

  const [curveId, setCurveId] = useState("");
  const [runId, setRunId] = useState("");
  const [expectedConc, setExpectedConc] = useState("");
  const [acceptance, setAcceptance] = useState("15");
  const [adding, setAdding] = useState(false);

  const { data: curveDetail, refetch } = useQuery({
    queryKey: ["cal-curve", curveId],
    queryFn: () => getCurveFn({ data: { id: curveId } }),
    enabled: !!curveId,
  });

  const handleAdd = async () => {
    if (!curveId || !runId || !expectedConc) {
      toast.error("Fill in curve, run, and expected concentration");
      return;
    }
    setAdding(true);
    try {
      // Try to auto-match a peak by analyte
      const analyteId = curves?.find((c: any) => c.id === curveId)?.analyteId;
      const selectedRun = runs.find((r) => r.id === runId);
      const matchedPeak = selectedRun?.peaks.find((p: any) => p.analyteId === analyteId);
      await addQcFn({
        data: {
          curveId,
          runId,
          peakId: matchedPeak?.id ?? null,
          expectedConc: parseFloat(expectedConc),
          acceptancePct: parseFloat(acceptance),
        },
      });
      toast.success("QC sample added");
      setExpectedConc("");
      refetch();
      qc.invalidateQueries({ queryKey: ["cal-curve", curveId] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to add QC sample");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Add QC sample
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Calibration curve</Label>
            <Select value={curveId} onValueChange={setCurveId}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue placeholder="Select curve…" />
              </SelectTrigger>
              <SelectContent>
                {(curves ?? []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.analyteName} — R²={c.rSquared?.toFixed(3)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Run</Label>
            <Select value={runId} onValueChange={setRunId}>
              <SelectTrigger className="w-56 h-8 text-xs">
                <SelectValue placeholder="Select run…" />
              </SelectTrigger>
              <SelectContent>
                {runs.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Expected conc.</Label>
            <Input
              type="number"
              value={expectedConc}
              onChange={(e) => setExpectedConc(e.target.value)}
              className="h-8 w-28 text-xs"
              placeholder="e.g. 50"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Acceptance ±%</Label>
            <Input
              type="number"
              value={acceptance}
              onChange={(e) => setAcceptance(e.target.value)}
              className="h-8 w-24 text-xs"
            />
          </div>
          <Button size="sm" disabled={adding} onClick={handleAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {adding ? "Adding…" : "Add QC"}
          </Button>
        </div>
      </Card>

      {curveId && (
        <Card className="border-border bg-card p-0">
          <div className="border-b border-border px-4 py-2 text-xs font-semibold">
            QC samples ({curveDetail?.qcSamples?.length ?? 0})
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[10px] uppercase">Expected</TableHead>
                <TableHead className="text-[10px] uppercase">Measured</TableHead>
                <TableHead className="text-[10px] uppercase">Accuracy</TableHead>
                <TableHead className="text-[10px] uppercase">Acceptance</TableHead>
                <TableHead className="text-[10px] uppercase">Pass/Fail</TableHead>
                <TableHead className="w-20 text-[10px] uppercase">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(curveDetail?.qcSamples ?? []).map((q: any) => (
                <TableRow key={q.id} className="text-xs">
                  <TableCell className="font-mono">{q.expectedConc.toFixed(2)}</TableCell>
                  <TableCell className="font-mono">{q.measuredConc?.toFixed(2) ?? "—"}</TableCell>
                  <TableCell className="font-mono">
                    {q.accuracyPct != null ? `${q.accuracyPct.toFixed(1)}%` : "—"}
                  </TableCell>
                  <TableCell className="font-mono text-muted-foreground">±{q.acceptancePct}%</TableCell>
                  <TableCell>
                    {q.passed === true && (
                      <Badge className="gap-1 bg-green-500/10 text-green-600 hover:bg-green-500/10">
                        <CheckCircle2 className="h-3 w-3" /> Pass
                      </Badge>
                    )}
                    {q.passed === false && (
                      <Badge className="gap-1 bg-red-500/10 text-red-600 hover:bg-red-500/10">
                        <XCircle className="h-3 w-3" /> Fail
                      </Badge>
                    )}
                    {q.passed == null && <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => {
                        deleteQcFn({ data: { id: q.id } });
                        refetch();
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!curveDetail?.qcSamples || curveDetail.qcSamples.length === 0) && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-xs text-muted-foreground">
                    No QC samples yet. Add one above.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
