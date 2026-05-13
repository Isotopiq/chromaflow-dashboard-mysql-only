import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { GradientStep, Method } from "@/lib/mock-data";

export const Route = createFileRoute("/_shell/methods/new")({
  component: NewMethod,
});

function NewMethod() {
  const { columns, addMethod, currentUser } = useLab();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [modality, setModality] = useState<Method["modality"]>("RP-LC-MS");
  const [columnId, setColumnId] = useState(columns[0]?.id ?? "");
  const [mpA, setMpA] = useState("0.1% formic acid in water");
  const [mpB, setMpB] = useState("0.1% formic acid in acetonitrile");
  const [flow, setFlow] = useState(0.4);
  const [temp, setTemp] = useState(40);
  const [inj, setInj] = useState(2);
  const [ion, setIon] = useState<Method["msIonization"]>("ESI+");
  const [notes, setNotes] = useState("");
  const [gradient, setGradient] = useState<GradientStep[]>([
    { time: 0, pctB: 5, flow: 0.4 },
    { time: 1, pctB: 5, flow: 0.4 },
    { time: 12, pctB: 95, flow: 0.4 },
    { time: 14, pctB: 95, flow: 0.4 },
  ]);

  const submit = () => {
    if (!name.trim()) return toast.error("Name required");
    const id = `m${Date.now()}`;
    addMethod({
      id,
      name,
      modality,
      columnId,
      status: "draft",
      mobilePhaseA: mpA,
      mobilePhaseB: mpB,
      gradient,
      flowRate: flow,
      columnTemp: temp,
      injectionVolume: inj,
      detector: "Q-TOF, full scan",
      msIonization: ion,
      msScanRange: [100, 1500],
      notes,
      createdBy: currentUser.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: ["draft"],
      runIds: [],
    });
    toast.success("Method created");
    navigate({ to: "/methods/$methodId", params: { methodId: id } });
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          New method
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Create method</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture chromatographic and MS parameters. You can attach runs and revise later.
        </p>
      </div>

      <Card className="border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Method name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. RP-LC-MS Polyphenols v3.2"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px]">Modality</Label>
            <Select value={modality} onValueChange={(v) => setModality(v as Method["modality"])}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="RP-LC-MS">RP-LC-MS</SelectItem>
                <SelectItem value="HILIC-MS">HILIC-MS</SelectItem>
                <SelectItem value="IEX">IEX</SelectItem>
                <SelectItem value="SEC">SEC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Column</Label>
            <Select value={columnId} onValueChange={setColumnId}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Mobile phase A</Label>
            <Input value={mpA} onChange={(e) => setMpA(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Mobile phase B</Label>
            <Input value={mpB} onChange={(e) => setMpB(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Flow (mL/min)</Label>
            <Input
              type="number"
              step="0.05"
              value={flow}
              onChange={(e) => setFlow(+e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px]">Column temp (°C)</Label>
            <Input
              type="number"
              value={temp}
              onChange={(e) => setTemp(+e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px]">Injection volume (µL)</Label>
            <Input
              type="number"
              value={inj}
              onChange={(e) => setInj(+e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-[11px]">MS ionization</Label>
            <Select value={ion} onValueChange={(v) => setIon(v as Method["msIonization"])}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ESI+">ESI +</SelectItem>
                <SelectItem value="ESI-">ESI −</SelectItem>
                <SelectItem value="APCI+">APCI +</SelectItem>
                <SelectItem value="APCI-">APCI −</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Gradient
            </Label>
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              onClick={() =>
                setGradient([
                  ...gradient,
                  { time: (gradient[gradient.length - 1]?.time ?? 0) + 1, pctB: 50, flow },
                ])
              }
            >
              <Plus className="mr-1 h-3 w-3" /> Step
            </Button>
          </div>
          <div className="mt-2 space-y-1">
            {gradient.map((g, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Input
                  type="number"
                  step="0.1"
                  value={g.time}
                  onChange={(e) => {
                    const next = [...gradient];
                    next[i] = { ...g, time: +e.target.value };
                    setGradient(next);
                  }}
                  className="font-mono text-xs"
                />
                <Input
                  type="number"
                  value={g.pctB}
                  onChange={(e) => {
                    const next = [...gradient];
                    next[i] = { ...g, pctB: +e.target.value };
                    setGradient(next);
                  }}
                  className="font-mono text-xs"
                />
                <Input
                  type="number"
                  step="0.05"
                  value={g.flow}
                  onChange={(e) => {
                    const next = [...gradient];
                    next[i] = { ...g, flow: +e.target.value };
                    setGradient(next);
                  }}
                  className="font-mono text-xs"
                />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => setGradient(gradient.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <Label className="text-[11px]">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="mt-1"
            placeholder="Validation status, intended analytes, known issues…"
          />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/methods" })}>
            Cancel
          </Button>
          <Button onClick={submit}>Create method</Button>
        </div>
      </Card>
    </div>
  );
}
