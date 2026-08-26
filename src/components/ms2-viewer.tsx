import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Zap, ArrowLeft, ArrowRight, GitCompare } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { getRunMS2Spectra } from "@/lib/lab.functions";

type MS2ScanSummary = {
  rt: number;
  precursorMz: number;
  collisionEnergy: number;
  peakCount: number;
  basePeak: number;
};

type MS2Spectrum = {
  precursorMz: number;
  collisionEnergy: number;
  rt: number;
  peaks: Array<{ mz: number; intensity: number }>;
};

export function MS2Viewer({
  runId,
  peakRt,
  peakMz,
}: {
  runId: string;
  peakRt?: number;
  peakMz?: number;
}) {
  const getMS2Fn = useServerFn(getRunMS2Spectra);
  const [selectedRt, setSelectedRt] = useState<number | null>(peakRt ?? null);
  const [selectedMz, setSelectedMz] = useState<number | null>(peakMz ?? null);
  const [compareIdx, setCompareIdx] = useState<number | null>(null);

  // Fetch MS2 scan list
  const { data: scanList, isLoading: listLoading } = useQuery({
    queryKey: ["ms2-scans", runId],
    queryFn: () => getMS2Fn({ data: { runId } }),
    enabled: !!runId,
  });

  // Fetch specific spectrum when RT + m/z selected
  const { data: spectrumData, isLoading: specLoading } = useQuery({
    queryKey: ["ms2-spectrum", runId, selectedRt, selectedMz],
    queryFn: () =>
      getMS2Fn({
        data: {
          runId,
          rt: selectedRt!,
          precursorMz: selectedMz!,
          rtTol: 0.2,
          ppmTol: 20,
        },
      }),
    enabled: selectedRt != null && selectedMz != null,
  });

  // Fetch comparison spectrum
  const { data: compareData } = useQuery({
    queryKey: ["ms2-compare", runId, compareIdx],
    queryFn: () => {
      const scans = (scanList?.spectra ?? []) as MS2ScanSummary[];
      const target = scans[compareIdx!];
      if (!target) return null;
      return getMS2Fn({
        data: {
          runId,
          rt: target.rt,
          precursorMz: target.precursorMz,
          rtTol: 0.2,
          ppmTol: 20,
        },
      });
    },
    enabled: compareIdx != null && scanList?.spectra != null,
  });

  if (!scanList?.hasMS2) {
    return (
      <Card className="border-border bg-card p-6 text-center">
        <Zap className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          No MS2 spectra available for this run.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          MS2 data is parsed from mzML/mzXML files containing MS2 scans.
        </p>
      </Card>
    );
  }

  const scans = (scanList?.spectra ?? []) as MS2ScanSummary[];
  const spectrum = spectrumData?.spectrum as MS2Spectrum | null | undefined;
  const compareSpectrum = compareData?.spectrum as MS2Spectrum | null | undefined;

  // Chart data for stick plot
  const chartData = useMemo(() => {
    if (!spectrum) return [];
    const maxIntens = Math.max(...spectrum.peaks.map((p) => p.intensity), 1);
    return spectrum.peaks.map((p) => ({
      mz: p.mz,
      intensity: p.intensity,
      relIntensity: (p.intensity / maxIntens) * 100,
    }));
  }, [spectrum]);

  // Mirror plot data (for comparison)
  const mirrorData = useMemo(() => {
    if (!spectrum || !compareSpectrum) return null;
    const allMz = new Set<number>();
    spectrum.peaks.forEach((p) => allMz.add(Math.round(p.mz * 100) / 100));
    compareSpectrum.peaks.forEach((p) => allMz.add(Math.round(p.mz * 100) / 100));
    const maxIntens1 = Math.max(...spectrum.peaks.map((p) => p.intensity), 1);
    const maxIntens2 = Math.max(...compareSpectrum.peaks.map((p) => p.intensity), 1);
    return Array.from(allMz).sort((a, b) => a - b).map((mz) => {
      const p1 = spectrum.peaks.find((p) => Math.abs(p.mz - mz) < 0.01);
      const p2 = compareSpectrum.peaks.find((p) => Math.abs(p.mz - mz) < 0.01);
      return {
        mz,
        top: p1 ? (p1.intensity / maxIntens1) * 100 : 0,
        bottom: p2 ? -(p2.intensity / maxIntens2) * 100 : 0,
      };
    });
  }, [spectrum, compareSpectrum]);

  // Similarity score (dot product / cosine similarity)
  const similarity = useMemo(() => {
    if (!spectrum || !compareSpectrum) return null;
    const allMz = new Set<number>();
    spectrum.peaks.forEach((p) => allMz.add(Math.round(p.mz * 100) / 100));
    compareSpectrum.peaks.forEach((p) => allMz.add(Math.round(p.mz * 100) / 100));
    let dot = 0, mag1 = 0, mag2 = 0;
    for (const mz of allMz) {
      const p1 = spectrum.peaks.find((p) => Math.abs(p.mz - mz) < 0.01)?.intensity ?? 0;
      const p2 = compareSpectrum.peaks.find((p) => Math.abs(p.mz - mz) < 0.01)?.intensity ?? 0;
      dot += p1 * p2;
      mag1 += p1 * p1;
      mag2 += p2 * p2;
    }
    if (mag1 === 0 || mag2 === 0) return 0;
    return dot / (Math.sqrt(mag1) * Math.sqrt(mag2));
  }, [spectrum, compareSpectrum]);

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            MS2 spectra ({scanList?.scanCount ?? 0} scans)
          </div>
          <h3 className="text-sm font-semibold">Tandem mass spectra</h3>
        </div>
      </div>

      {/* Scan selector */}
      <Card className="border-border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Select MS2 scan</Label>
            <Select
              value={selectedRt?.toString() ?? ""}
              onValueChange={(v) => {
                const scan = scans.find((s) => s.rt === parseFloat(v));
                if (scan) {
                  setSelectedRt(scan.rt);
                  setSelectedMz(scan.precursorMz);
                }
              }}
            >
              <SelectTrigger className="w-64 h-8 text-xs">
                <SelectValue placeholder="Choose a scan…" />
              </SelectTrigger>
              <SelectContent>
                {scans.map((s, i) => (
                  <SelectItem key={i} value={s.rt.toString()} className="text-xs">
                    RT {s.rt.toFixed(2)} min · prec {s.precursorMz.toFixed(2)} · {s.peakCount} peaks
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedRt != null && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const idx = scans.findIndex((s) => s.rt === selectedRt);
                if (idx > 0) {
                  setSelectedRt(scans[idx - 1].rt);
                  setSelectedMz(scans[idx - 1].precursorMz);
                }
              }}
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          )}
          {selectedRt != null && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const idx = scans.findIndex((s) => s.rt === selectedRt);
                if (idx >= 0 && idx < scans.length - 1) {
                  setSelectedRt(scans[idx + 1].rt);
                  setSelectedMz(scans[idx + 1].precursorMz);
                }
              }}
            >
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          )}
          {spectrum && (
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline" className="text-[10px]">
                prec m/z: {spectrum.precursorMz.toFixed(4)}
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                CE: {spectrum.collisionEnergy.toFixed(1)} eV
              </Badge>
              <Badge variant="outline" className="text-[10px]">
                {spectrum.peaks.length} peaks
              </Badge>
            </div>
          )}
        </div>
      </Card>

      {/* Stick plot or mirror plot */}
      {specLoading && (
        <Card className="border-border bg-card p-12 text-center text-xs text-muted-foreground">
          Loading spectrum…
        </Card>
      )}

      {!specLoading && spectrum && !compareSpectrum && (
        <Card className="border-border bg-card p-4">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
            Stick plot — relative intensity
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="mz"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  label={{ value: "m/z", position: "bottom", fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  label={{ value: "Rel. %", angle: -90, position: "insideLeft", fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                  formatter={(v: any) => [`${v.toFixed(1)}%`, "Rel. intensity"]}
                  labelFormatter={(l: any) => `m/z: ${Number(l).toFixed(4)}`}
                />
                <Bar dataKey="relIntensity" fill="var(--primary)" shape={<StickBar />} />
                {spectrum.precursorMz > 0 && (
                  <ReferenceLine
                    x={spectrum.precursorMz}
                    stroke="var(--destructive)"
                    strokeDasharray="4 4"
                    label={{ value: "prec", fontSize: 10, fill: "var(--destructive)" }}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Mirror plot */}
      {!specLoading && spectrum && compareSpectrum && mirrorData && (
        <Card className="border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Mirror plot — top: selected · bottom: comparison
            </div>
            {similarity != null && (
              <Badge className="text-[10px]" variant="outline">
                Cosine similarity: {similarity.toFixed(3)}
              </Badge>
            )}
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mirrorData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="mz"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  label={{ value: "m/z", position: "bottom", fontSize: 11 }}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  fontSize={11}
                  domain={[-100, 100]}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="top" fill="var(--primary)" shape={<StickBar />} />
                <Bar dataKey="bottom" fill="var(--chart-2)" shape={<StickBarDown />} />
                <ReferenceLine y={0} stroke="var(--border)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Comparison selector */}
      {spectrum && scans.length > 1 && (
        <Card className="border-border bg-card p-3">
          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Compare with…</Label>
              <Select
                value={compareIdx?.toString() ?? ""}
                onValueChange={(v) => setCompareIdx(parseInt(v, 10))}
              >
                <SelectTrigger className="w-64 h-8 text-xs">
                  <SelectValue placeholder="Select scan to compare…" />
                </SelectTrigger>
                <SelectContent>
                  {scans.map((s, i) => (
                    <SelectItem key={i} value={i.toString()} className="text-xs">
                      RT {s.rt.toFixed(2)} · prec {s.precursorMz.toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {compareIdx != null && (
              <Button size="sm" variant="ghost" onClick={() => setCompareIdx(null)}>
                Clear comparison
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Peak table */}
      {spectrum && (
        <Card className="border-border bg-card p-0">
          <div className="border-b border-border px-4 py-2 text-xs font-semibold">
            Fragment ions ({spectrum.peaks.length})
          </div>
          <div className="max-h-48 overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  <TableHead className="text-[10px] uppercase">m/z</TableHead>
                  <TableHead className="text-[10px] uppercase">Intensity</TableHead>
                  <TableHead className="text-[10px] uppercase">Rel. %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spectrum.peaks
                  .slice()
                  .sort((a, b) => b.intensity - a.intensity)
                  .slice(0, 50)
                  .map((p, i) => {
                    const maxI = Math.max(...spectrum.peaks.map((q) => q.intensity));
                    return (
                      <TableRow key={i} className="text-xs">
                        <TableCell className="font-mono">{p.mz.toFixed(4)}</TableCell>
                        <TableCell className="font-mono">{p.intensity.toExponential(2)}</TableCell>
                        <TableCell className="font-mono">{((p.intensity / maxI) * 100).toFixed(1)}%</TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
    </div>
  );
}

// Custom stick bar shape (thin vertical line)
function StickBar(props: any) {
  const { x, y, width, height } = props;
  const stickWidth = 1.5;
  return (
    <rect
      x={x + width / 2 - stickWidth / 2}
      y={y}
      width={stickWidth}
      height={height}
      fill={props.fill}
    />
  );
}

function StickBarDown(props: any) {
  const { x, y, width, height } = props;
  const stickWidth = 1.5;
  // For negative values, y is 0 and height is negative (recharts handles this)
  return (
    <rect
      x={x + width / 2 - stickWidth / 2}
      y={y}
      width={stickWidth}
      height={Math.abs(height)}
      fill={props.fill}
    />
  );
}
