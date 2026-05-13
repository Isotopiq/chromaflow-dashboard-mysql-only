import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChromatogramPlot } from "@/components/chromatogram-plot";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/methods/compare")({
  component: CompareMethods,
});

function CompareMethods() {
  const { methods, runs, columns } = useLab();
  const [aId, setA] = useState(methods[0]?.id ?? "");
  const [bId, setB] = useState(methods[1]?.id ?? methods[0]?.id ?? "");
  const a = methods.find((m) => m.id === aId)!;
  const b = methods.find((m) => m.id === bId)!;
  const aRun = runs.find((r) => r.methodId === aId);
  const bRun = runs.find((r) => r.methodId === bId);

  const fields: Array<[string, (m: typeof a) => string]> = [
    ["Modality", (m) => m.modality],
    ["Column", (m) => columns.find((c) => c.id === m.columnId)?.name ?? "—"],
    ["Mobile phase A", (m) => m.mobilePhaseA],
    ["Mobile phase B", (m) => m.mobilePhaseB],
    ["Flow", (m) => `${m.flowRate} mL/min`],
    ["Column temp", (m) => `${m.columnTemp} °C`],
    ["Injection vol", (m) => `${m.injectionVolume} µL`],
    ["Ionization", (m) => m.msIonization],
    ["Scan range", (m) => `${m.msScanRange[0]}–${m.msScanRange[1]}`],
    ["Status", (m) => m.status],
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Compare methods
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Side-by-side comparison</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pick two methods to diff parameters and overlay representative chromatograms.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MethodPicker label="Method A" value={aId} onChange={setA} methods={methods} />
        <MethodPicker label="Method B" value={bId} onChange={setB} methods={methods} />
      </div>

      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Parameter diff
        </div>
        <div className="mt-3 grid grid-cols-[140px_1fr_1fr] gap-x-4 gap-y-2 text-xs">
          <div></div>
          <div className="font-medium">{a.name}</div>
          <div className="font-medium">{b.name}</div>
          {fields.map(([label, get]) => {
            const va = get(a);
            const vb = get(b);
            const diff = va !== vb;
            return (
              <FieldRow key={label} label={label} a={va} b={vb} diff={diff} />
            );
          })}
        </div>
      </Card>

      {aRun && bRun && (
        <Card className="border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Representative overlay
              </div>
              <h2 className="text-sm font-semibold">Chromatogram comparison</h2>
            </div>
            <div className="flex gap-2 text-[10px]">
              <Badge variant="outline" className="border-[color:var(--chart-1)]">
                {aRun.name}
              </Badge>
              <Badge variant="outline" className="border-[color:var(--chart-2)]">
                {bRun.name}
              </Badge>
            </div>
          </div>
          <div className="mt-3">
            <ChromatogramPlot
              runs={[
                { id: aRun.id, name: aRun.name, trace: aRun.trace },
                { id: bRun.id, name: bRun.name, trace: bRun.trace },
              ]}
              height={300}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

function MethodPicker({
  label,
  value,
  onChange,
  methods,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  methods: import("@/lib/mock-data").Method[];
}) {
  return (
    <Card className="border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-2">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {methods.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Card>
  );
}

function FieldRow({
  label,
  a,
  b,
  diff,
}: {
  label: string;
  a: string;
  b: string;
  diff: boolean;
}) {
  return (
    <>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("font-mono", diff && "text-[color:var(--status-warn)]")}>{a}</div>
      <div className={cn("font-mono", diff && "text-[color:var(--status-warn)]")}>{b}</div>
    </>
  );
}
