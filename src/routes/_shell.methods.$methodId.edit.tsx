import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useLab, useUpsertMethod } from "@/lib/store";
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
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { GradientStep, Method } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/methods/$methodId/edit")({
  component: EditMethod,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Method not found.</div>
  ),
});

function EditMethod() {
  const { methodId } = Route.useParams();
  const { methods, columns, hydrated } = useLab();
  const method = methods.find((m) => m.id === methodId);
  const upsertMethod = useUpsertMethod();
  const navigate = useNavigate();

  const [name, setName] = useState(method?.name ?? "");
  const [modality, setModality] = useState<Method["modality"]>(method?.modality ?? "RP-LC-MS");
  const [columnId, setColumnId] = useState(method?.columnId ?? columns[0]?.id ?? "");
  const [status, setStatus] = useState<Method["status"]>(method?.status ?? "draft");
  const [mpA, setMpA] = useState(method?.mobilePhaseA ?? "");
  const [mpB, setMpB] = useState(method?.mobilePhaseB ?? "");
  const [flow, setFlow] = useState(method?.flowRate ?? 0.4);
  const [temp, setTemp] = useState(method?.columnTemp ?? 40);
  const [inj, setInj] = useState(method?.injectionVolume ?? 2);
  const [detector, setDetector] = useState(method?.detector ?? "Q-TOF, full scan");
  const [ion, setIon] = useState<Method["msIonization"]>(method?.msIonization ?? "ESI+");
  const [scanLo, setScanLo] = useState(method?.msScanRange?.[0] ?? 100);
  const [scanHi, setScanHi] = useState(method?.msScanRange?.[1] ?? 1500);
  const [notes, setNotes] = useState(method?.notes ?? "");
  const [tagsStr, setTagsStr] = useState((method?.tags ?? []).join(", "));
  const [gradient, setGradient] = useState<GradientStep[]>(method?.gradient ?? []);

  if (!method) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <Link to="/methods" className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> All methods
        </Link>
        <Card className="border-border bg-card p-6 text-sm">
          {hydrated ? "Method not found." : "Loading method…"}
        </Card>
      </div>
    );
  }

  const submit = async () => {
    if (!name.trim()) return toast.error("Name required");
    try {
      const saved = await upsertMethod({
        ...method,
        name,
        modality,
        columnId,
        status,
        mobilePhaseA: mpA,
        mobilePhaseB: mpB,
        gradient,
        flowRate: flow,
        columnTemp: temp,
        injectionVolume: inj,
        detector,
        msIonization: ion,
        msScanRange: [scanLo, scanHi],
        notes,
        tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
        updatedAt: new Date().toISOString(),
      });
      toast.success("Method saved");
      navigate({ to: "/methods/$methodId", params: { methodId: saved.id } });
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <Link to="/methods/$methodId" params={{ methodId }} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3 w-3" /> Back to method
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Edit method</h1>
      </div>

      <Card className="border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Method name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Modality</Label>
            <Select value={modality} onValueChange={(v) => setModality(v as Method["modality"])}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RP-LC-MS">RP-LC-MS</SelectItem>
                <SelectItem value="HILIC-MS">HILIC-MS</SelectItem>
                <SelectItem value="IEX">IEX</SelectItem>
                <SelectItem value="SEC">SEC</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as Method["status"])}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="validated">Validated</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Column</Label>
            <Select value={columnId} onValueChange={setColumnId}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {columns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
            <Input type="number" step="0.05" value={flow} onChange={(e) => setFlow(+e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Column temp (°C)</Label>
            <Input type="number" value={temp} onChange={(e) => setTemp(+e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Injection volume (µL)</Label>
            <Input type="number" value={inj} onChange={(e) => setInj(+e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">Detector</Label>
            <Input value={detector} onChange={(e) => setDetector(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-[11px]">MS ionization</Label>
            <Select value={ion} onValueChange={(v) => setIon(v as Method["msIonization"])}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ESI+">ESI +</SelectItem>
                <SelectItem value="ESI-">ESI −</SelectItem>
                <SelectItem value="APCI+">APCI +</SelectItem>
                <SelectItem value="APCI-">APCI −</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Scan range low (m/z)</Label>
              <Input type="number" value={scanLo} onChange={(e) => setScanLo(+e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-[11px]">Scan range high (m/z)</Label>
              <Input type="number" value={scanHi} onChange={(e) => setScanHi(+e.target.value)} className="mt-1" />
            </div>
          </div>
          <div className="sm:col-span-2">
            <Label className="text-[11px]">Tags (comma-separated)</Label>
            <Input value={tagsStr} onChange={(e) => setTagsStr(e.target.value)} className="mt-1" />
          </div>
        </div>

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">Gradient</Label>
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
          <div className="mt-2 grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <div>Time (min)</div><div>% B</div><div>Flow (mL/min)</div><div />
          </div>
          <div className="mt-1 space-y-1">
            {gradient.map((g, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Input type="number" step="0.1" value={g.time} onChange={(e) => { const n = [...gradient]; n[i] = { ...g, time: +e.target.value }; setGradient(n); }} className="font-mono text-xs" />
                <Input type="number" value={g.pctB} onChange={(e) => { const n = [...gradient]; n[i] = { ...g, pctB: +e.target.value }; setGradient(n); }} className="font-mono text-xs" />
                <Input type="number" step="0.05" value={g.flow} onChange={(e) => { const n = [...gradient]; n[i] = { ...g, flow: +e.target.value }; setGradient(n); }} className="font-mono text-xs" />
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setGradient(gradient.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <Label className="text-[11px]">Notes</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="mt-1" />
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => navigate({ to: "/methods/$methodId", params: { methodId } })}>
            Cancel
          </Button>
          <Button onClick={submit}>Save changes</Button>
        </div>
      </Card>
    </div>
  );
}
