import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CheckCircle2, XCircle, Settings2, Download } from "lucide-react";
import {
  runSystemSuitability,
  uspResolution,
  uspPlateCount,
  uspTailingFactor,
  signalToNoise,
  rsdPct,
  type SSTResult,
  type SSTCriteria,
  DEFAULT_SST_CRITERIA,
} from "@/lib/calibration-math";
import { downloadCsv } from "@/lib/exports";

type Peak = {
  id: string;
  rt: number;
  area: number;
  height: number;
  fwhm: number;
  sn: number;
  mz?: number;
  asymmetry?: number;
  analyteName?: string;
};

export function SystemSuitability({ peaks }: { peaks: Peak[] }) {
  const [criteria, setCriteria] = useState<SSTCriteria>(DEFAULT_SST_CRITERIA);
  const [showSettings, setShowSettings] = useState(false);

  // Group peaks by analyte (or use all if no analytes assigned)
  const replicates = useMemo(() => {
    return peaks.map((p) => ({
      rt: p.rt,
      area: p.area,
      fwhm: p.fwhm,
      height: p.height,
      sn: p.sn,
      tailing: p.asymmetry ?? 1,
    }));
  }, [peaks]);

  const sstResults = useMemo<SSTResult[]>(() => {
    if (replicates.length === 0) return [];
    return runSystemSuitability(replicates, criteria);
  }, [replicates, criteria]);

  // Resolution between adjacent peaks
  const resolutionResults = useMemo(() => {
    if (peaks.length < 2) return [];
    const sorted = [...peaks].sort((a, b) => a.rt - b.rt);
    const results: Array<{ pair: string; rs: number; pass: boolean }> = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const p1 = sorted[i];
      const p2 = sorted[i + 1];
      // Estimate baseline width from FWHM (W ≈ 1.7 * FWHM for Gaussian)
      const w1 = p1.fwhm * 1.7;
      const w2 = p2.fwhm * 1.7;
      const rs = uspResolution(p1.rt, p2.rt, w1, w2);
      results.push({
        pair: `${p1.analyteName ?? p1.mz?.toFixed(2) ?? p1.rt.toFixed(2)} → ${p2.analyteName ?? p2.mz?.toFixed(2) ?? p2.rt.toFixed(2)}`,
        rs: +rs.toFixed(2),
        pass: rs >= criteria.resolutionMin,
      });
    }
    return results;
  }, [peaks, criteria.resolutionMin]);

  const allPassed = sstResults.every((r) => r.passed) && resolutionResults.every((r) => r.pass);

  const handleExport = () => {
    const rows = [
      ...sstResults.map((r) => ({
        Category: "System Suitability",
        Criterion: r.criterion,
        Value: r.value.toFixed(3),
        Unit: r.unit,
        Specification: r.spec,
        Result: r.passed ? "PASS" : "FAIL",
      })),
      ...resolutionResults.map((r) => ({
        Category: "Resolution",
        Criterion: r.pair,
        Value: r.rs.toFixed(2),
        Unit: "",
        Specification: `≥ ${criteria.resolutionMin}`,
        Result: r.pass ? "PASS" : "FAIL",
      })),
    ];
    downloadCsv("system-suitability", rows);
  };

  if (peaks.length === 0) {
    return (
      <Card className="border-border bg-card p-6 text-center">
        <Settings2 className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          No peaks available for system suitability testing.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            System suitability (USP/EP)
          </div>
          <div className="mt-1 flex items-center gap-2">
            <h3 className="text-sm font-semibold">SST Results</h3>
            {allPassed ? (
              <Badge className="gap-1 bg-green-500/10 text-green-600 hover:bg-green-500/10">
                <CheckCircle2 className="h-3 w-3" /> All pass
              </Badge>
            ) : (
              <Badge className="gap-1 bg-red-500/10 text-red-600 hover:bg-red-500/10">
                <XCircle className="h-3 w-3" /> Failures detected
              </Badge>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowSettings((v) => !v)}>
            <Settings2 className="mr-1 h-3.5 w-3.5" /> Criteria
          </Button>
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Acceptance criteria
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">RT RSD% max</Label>
              <Input
                type="number"
                value={criteria.rsdMaxPct}
                onChange={(e) => setCriteria({ ...criteria, rsdMaxPct: parseFloat(e.target.value) || 0 })}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Tailing min</Label>
              <Input
                type="number"
                value={criteria.tailingMin}
                onChange={(e) => setCriteria({ ...criteria, tailingMin: parseFloat(e.target.value) || 0 })}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Tailing max</Label>
              <Input
                type="number"
                value={criteria.tailingMax}
                onChange={(e) => setCriteria({ ...criteria, tailingMax: parseFloat(e.target.value) || 0 })}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Min plates</Label>
              <Input
                type="number"
                value={criteria.platesMin}
                onChange={(e) => setCriteria({ ...criteria, platesMin: parseInt(e.target.value) || 0 })}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Min resolution</Label>
              <Input
                type="number"
                value={criteria.resolutionMin}
                onChange={(e) => setCriteria({ ...criteria, resolutionMin: parseFloat(e.target.value) || 0 })}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">Min S/N</Label>
              <Input
                type="number"
                value={criteria.snMin}
                onChange={(e) => setCriteria({ ...criteria, snMin: parseFloat(e.target.value) || 0 })}
                className="h-8 text-xs"
              />
            </div>
          </div>
        </Card>
      )}

      {/* SST results table */}
      <Card className="border-border bg-card p-0">
        <div className="border-b border-border px-4 py-2 text-xs font-semibold">
          System suitability tests ({sstResults.length})
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase">Criterion</TableHead>
              <TableHead className="text-[10px] uppercase">Value</TableHead>
              <TableHead className="text-[10px] uppercase">Unit</TableHead>
              <TableHead className="text-[10px] uppercase">Specification</TableHead>
              <TableHead className="text-[10px] uppercase">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sstResults.map((r, i) => (
              <TableRow key={i} className="text-xs">
                <TableCell className="font-medium">{r.criterion}</TableCell>
                <TableCell className="font-mono">{r.value.toFixed(3)}</TableCell>
                <TableCell className="text-muted-foreground">{r.unit}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{r.spec}</TableCell>
                <TableCell>
                  {r.passed ? (
                    <Badge className="gap-1 bg-green-500/10 text-green-600 hover:bg-green-500/10">
                      <CheckCircle2 className="h-3 w-3" /> Pass
                    </Badge>
                  ) : (
                    <Badge className="gap-1 bg-red-500/10 text-red-600 hover:bg-red-500/10">
                      <XCircle className="h-3 w-3" /> Fail
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Resolution table */}
      {resolutionResults.length > 0 && (
        <Card className="border-border bg-card p-0">
          <div className="border-b border-border px-4 py-2 text-xs font-semibold">
            Resolution between adjacent peaks (Rs)
          </div>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[10px] uppercase">Peak pair</TableHead>
                <TableHead className="text-[10px] uppercase">Rs</TableHead>
                <TableHead className="text-[10px] uppercase">Specification</TableHead>
                <TableHead className="text-[10px] uppercase">Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resolutionResults.map((r, i) => (
                <TableRow key={i} className="text-xs">
                  <TableCell className="font-medium">{r.pair}</TableCell>
                  <TableCell className="font-mono">{r.rs.toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-muted-foreground">≥ {criteria.resolutionMin}</TableCell>
                  <TableCell>
                    {r.pass ? (
                      <Badge className="gap-1 bg-green-500/10 text-green-600 hover:bg-green-500/10">
                        <CheckCircle2 className="h-3 w-3" /> Pass
                      </Badge>
                    ) : (
                      <Badge className="gap-1 bg-red-500/10 text-red-600 hover:bg-red-500/10">
                        <XCircle className="h-3 w-3" /> Fail
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
