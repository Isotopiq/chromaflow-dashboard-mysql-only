import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useLab, useUpsertMethod, useUploadMethodFile } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Trash2, Upload, FileUp, ChevronDown, ChevronRight, Edit3, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { GradientStep, Method, MsScan, MsGlobalSettings } from "@/lib/lab-types";
import {
  parseMethodFile,
  buildFieldGroups,
  type ParsedMethodFile,
  type ImportableField,
  type FieldGroup,
} from "@/lib/method-import";

export const Route = createFileRoute("/_shell/methods/new")({
  component: NewMethod,
});

function NewMethod() {
  const { columns, currentUser } = useLab();
  const upsertMethod = useUpsertMethod();
  const uploadMethodFile = useUploadMethodFile();
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
  const [detector, setDetector] = useState("Orbitrap, full scan");
  const [notes, setNotes] = useState("");
  const [gradient, setGradient] = useState<GradientStep[]>([
    { time: 0, pctB: 5, flow: 0.4 },
    { time: 1, pctB: 5, flow: 0.4 },
    { time: 12, pctB: 95, flow: 0.4 },
    { time: 14, pctB: 95, flow: 0.4 },
  ]);

  // --- MS scan state (from import) ---
  const [msGlobalSettings, setMsGlobalSettings] = useState<MsGlobalSettings | null>(null);
  const [msScans, setMsScans] = useState<MsScan[]>([]);
  const [editingScans, setEditingScans] = useState(false);

  function updateScan(index: number, patch: Partial<MsScan>) {
    setMsScans((prev) => prev.map((s, j) => (j === index ? { ...s, ...patch } : s)));
  }

  // --- Method file import state ---
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [parsedFile, setParsedFile] = useState<ParsedMethodFile | null>(null);
  const [rawFile, setRawFile] = useState<File | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<ImportableField>>(new Set());
  const [parsing, setParsing] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [selectedPump, setSelectedPump] = useState<string>(""); // pump prefix

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await parseMethodFile(file);
      setParsedFile(parsed);
      setRawFile(file);
      const groups = buildFieldGroups(parsed);
      // Default: select all fields
      const allKeys = groups.flatMap((g) => g.fields.map((f) => f.key));
      setSelectedFields(new Set(allKeys));
      // Expand all groups by default
      setExpandedGroups(new Set(groups.map((g) => g.title)));
      setImportDialogOpen(true);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to parse method file");
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function applyImport() {
    if (!parsedFile) return;
    const p = parsedFile;

    // If the user selected a specific pump, use its gradient
    const effectiveGradient = selectedPump
      ? (p.pumpGradients.find((pg) => pg.pumpName === selectedPump)?.gradient ?? p.gradient)
      : p.gradient;

    if (selectedFields.has("name") && p.name) setName(p.name);
    if (selectedFields.has("mobilePhaseA") && p.mobilePhaseA) setMpA(p.mobilePhaseA);
    if (selectedFields.has("mobilePhaseB") && p.mobilePhaseB) setMpB(p.mobilePhaseB);
    if (selectedFields.has("flowRate") && p.flowRate != null) setFlow(p.flowRate);
    if (selectedFields.has("columnTemp") && p.columnTempC != null) setTemp(p.columnTempC);
    if (selectedFields.has("injectionVolume") && p.injectionVolumeUl != null) setInj(p.injectionVolumeUl);
    if (selectedFields.has("gradient") && effectiveGradient.length > 0) {
      setGradient(effectiveGradient.map((g) => ({ time: g.time, pctB: g.pctB, flow: g.flow })));
    }
    if (selectedFields.has("notes")) {
      const noteParts: string[] = [];
      if (p.runTimeMin != null) noteParts.push(`Run time: ${p.runTimeMin} min`);
      if (p.instrument) noteParts.push(`Instrument: ${p.instrument}`);
      if (p.sampleTempC != null) noteParts.push(`Sample temp: ${p.sampleTempC} °C`);
      if (p.pressureLimitBar != null) noteParts.push(`Pressure limit: ${p.pressureLimitBar} bar`);
      if (noteParts.length > 0) setNotes(noteParts.join("\n"));
    }
    if (selectedFields.has("msGlobalSettings") && p.msGlobalSettings) {
      setMsGlobalSettings(p.msGlobalSettings);
    }
    // Build the final scan list from the parsed file, combining MS1 + ddMS2
    // as selected. We must not read msScans state here because setMsScans
    // is async and the second block would see stale state.
    const wantMs1 = selectedFields.has("ms1Scan");
    const wantDdms2 = selectedFields.has("ddMS2Scans");
    if (wantMs1 || wantDdms2) {
      const importedMs1 = wantMs1 ? p.msScans.filter((s) => s.scanType === "MS1") : [];
      const importedDdms2 = wantDdms2 ? p.msScans.filter((s) => s.scanType === "ddMS2") : [];
      // Keep any existing scans of types NOT being imported
      const keepTypes = new Set<string>();
      if (!wantMs1) keepTypes.add("MS1");
      if (!wantDdms2) keepTypes.add("ddMS2");
      const kept = keepTypes.size > 0
        ? msScans.filter((s) => keepTypes.has(s.scanType))
        : [];
      setMsScans([...importedMs1, ...importedDdms2, ...kept]);
      // Set ionization from MS1 polarity(ies)
      if (importedMs1.length > 0) {
        const polarities = new Set(importedMs1.map((s) => s.polarity).filter(Boolean));
        if (polarities.has("Positive") && polarities.has("Negative")) setIon("ESI±");
        else if (polarities.has("Both")) setIon("ESI±");
        else if (polarities.has("Positive")) setIon("ESI+");
        else if (polarities.has("Negative")) setIon("ESI-");
      }
    }

    // Guess modality from solvent names
    if (p.mobilePhaseB && /acn|acetonitrile/i.test(p.mobilePhaseB)) {
      if (p.gradient.length > 0 && p.gradient[0].pctB > 80) {
        setModality("HILIC-MS");
      } else {
        setModality("RP-LC-MS");
      }
    }

    const count = selectedFields.size;
    toast.success(`Imported ${count} field${count === 1 ? "" : "s"} from method file`);
    setImportDialogOpen(false);
  }

  function toggleField(key: ImportableField) {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(title: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  function toggleGroupAll(group: FieldGroup) {
    const groupKeys = group.fields.map((f) => f.key);
    const allSelected = groupKeys.every((k) => selectedFields.has(k));
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        groupKeys.forEach((k) => next.delete(k));
      } else {
        groupKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  }

  const submit = async () => {
    if (!name.trim()) return toast.error("Name required");
    try {
      // Derive MS scan range from MS1 scan if available
      const ms1Scan = msScans.find((s) => s.scanType === "MS1");
      const scanRange: [number, number] = ms1Scan?.scanRangeMz ?? [100, 1500];

      const saved = await upsertMethod({
        id: undefined as any,
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
        detector,
        msIonization: ion,
        msScanRange: scanRange,
        msGlobalSettings,
        msScans,
        methodFilePath: null,
        methodFileName: rawFile?.name ?? null,
        notes,
        createdBy: currentUser.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tags: ["draft"],
        runIds: [],
      } as any);

      // Upload the .meth file if the user selected that option
      if (selectedFields.has("methodFile") && rawFile) {
        try {
          const fileData = await rawFile.arrayBuffer();
          // Encode to base64 in chunks to avoid call stack overflow
          const bytes = new Uint8Array(fileData);
          let binary = "";
          const chunkSize = 0x8000; // 32KB chunks
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize) as any);
          }
          const base64 = btoa(binary);
          await uploadMethodFile({
            data: {
              methodId: saved.id,
              fileName: rawFile.name,
              fileDataBase64: base64,
            },
          });
          toast.success("Method file saved");
        } catch (uploadErr: any) {
          toast.error(`Method file upload failed: ${uploadErr?.message ?? "error"}`);
        }
      }

      toast.success("Method created");
      navigate({ to: "/methods/$methodId", params: { methodId: saved.id } });
    } catch (err: any) {
      toast.error(err?.message ?? "Save failed");
    }
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

      {/* Import from instrument method file */}
      <Card className="border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-3">
          <FileUp className="h-5 w-5 text-primary" />
          <div className="flex-1">
            <div className="text-sm font-medium">Import from instrument method file</div>
            <div className="text-xs text-muted-foreground">
              Upload a Chromeleon <span className="font-mono">.meth</span> file to pre-fill LC + MS parameters. You choose which data to keep.
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".meth,.xml,.txt"
            onChange={handleFileSelected}
            className="hidden"
          />
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={parsing}
          >
            <Upload className="mr-1 h-3.5 w-3.5" />
            {parsing ? "Parsing…" : "Choose file"}
          </Button>
        </div>
        {rawFile && (
          <div className="mt-2 text-xs text-muted-foreground">
            Selected: <span className="font-mono">{rawFile.name}</span> ({(rawFile.size / 1024).toFixed(0)} KB)
          </div>
        )}
      </Card>

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
                <SelectItem value="ESI±">ESI ± (polarity switching)</SelectItem>
                <SelectItem value="APCI+">APCI +</SelectItem>
                <SelectItem value="APCI-">APCI −</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[11px]">Detector</Label>
            <Select value={detector} onValueChange={setDetector}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Orbitrap, full scan">Orbitrap, full scan</SelectItem>
                <SelectItem value="Orbitrap, data-dependent MS2">Orbitrap, data-dependent MS2</SelectItem>
                <SelectItem value="Orbitrap, PRM">Orbitrap, PRM</SelectItem>
                <SelectItem value="Orbitrap, AIF">Orbitrap, AIF</SelectItem>
                <SelectItem value="Q-TOF, full scan">Q-TOF, full scan</SelectItem>
                <SelectItem value="Q-TOF, data-dependent MS2">Q-TOF, data-dependent MS2</SelectItem>
                <SelectItem value="QQQ, MRM">QQQ, MRM</SelectItem>
                <SelectItem value="QQQ, PRM">QQQ, PRM</SelectItem>
                <SelectItem value="Ion trap, full scan">Ion trap, full scan</SelectItem>
                <SelectItem value="Ion trap, data-dependent MS2">Ion trap, data-dependent MS2</SelectItem>
                <SelectItem value="TOF, full scan">TOF, full scan</SelectItem>
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

        {/* MS Scans (editable, if imported) */}
        {msScans.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between">
              <Label className="text-[11px] uppercase tracking-widest text-muted-foreground">
                MS Scan Definitions ({msScans.length})
              </Label>
              <div className="flex gap-2">
                {editingScans ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => setEditingScans(false)}
                    >
                      <X className="mr-1 h-3 w-3" /> Done
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => setMsScans([
                        ...msScans,
                        {
                          scanType: "MS1",
                          experimentName: "New Scan",
                          startTimeMin: null,
                          endTimeMin: null,
                          orbitrapResolution: null,
                          scanRangeMz: null,
                          agcTarget: null,
                          microscans: null,
                          rfLensPct: null,
                          maxInjectionTimeMode: null,
                          maxInjectionTimeMs: null,
                          dataType: null,
                          polarity: null,
                          sourceFragmentation: null,
                          lockMassInjection: null,
                          scanDescription: null,
                          isolationOffset: null,
                          isolationWindow: null,
                          isolationWindowMz: null,
                          multiplexIonsEnabled: null,
                          maxMultiplexedIons: null,
                          reportedMass: null,
                          turboTmt: null,
                          scanRangeMode: null,
                          intensityThreshold: null,
                          dynamicExclusionMode: null,
                          isotopeExclusion: null,
                          precursorSelectionRange: null,
                          extraParams: [],
                        },
                      ])}
                    >
                      <Plus className="mr-1 h-3 w-3" /> Add scan
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setEditingScans(true)}
                  >
                    <Edit3 className="mr-1 h-3 w-3" /> Edit scans
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-2 space-y-3">
              {msScans.map((s, i) => (
                <div key={i} className="rounded-md border border-border p-3">
                  {editingScans ? (
                    <>
                      <div className="flex items-center gap-2">
                        <Select
                          value={s.scanType}
                          onValueChange={(v) => updateScan(i, { scanType: v as MsScan["scanType"] })}
                        >
                          <SelectTrigger className="h-7 w-32 text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MS1">MS1</SelectItem>
                            <SelectItem value="ddMS2">ddMS2</SelectItem>
                            <SelectItem value="tSIM">tSIM</SelectItem>
                            <SelectItem value="tMS2">tMS2</SelectItem>
                            <SelectItem value="PRM">PRM</SelectItem>
                            <SelectItem value="AllIons">AllIons</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={s.experimentName}
                          onChange={(e) => updateScan(i, { experimentName: e.target.value })}
                          className="h-7 flex-1 text-sm"
                          placeholder="Experiment name"
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setMsScans(msScans.filter((_, j) => j !== i))}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      <NewMethodScanFields scan={s} index={i} updateScan={updateScan} />
                    </>
                  ) : (
                    <div className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="text-[10px]">{s.scanType}</Badge>
                      <span className="font-medium">{s.experimentName || `Scan ${i + 1}`}</span>
                      {s.orbitrapResolution && <span className="text-muted-foreground">R={s.orbitrapResolution}</span>}
                      {s.scanRangeMz && <span className="text-muted-foreground">{s.scanRangeMz[0]}-{s.scanRangeMz[1]} m/z</span>}
                      {s.polarity && <span className="text-muted-foreground">{s.polarity}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

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

      {/* Import field selection dialog with grouped categories */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import method fields</DialogTitle>
            <DialogDescription>
              Select which values to import from the instrument method file. Unchecked fields will keep their current values.
            </DialogDescription>
          </DialogHeader>
          {parsedFile && (
            <div className="max-h-[500px] space-y-2 overflow-y-auto">
              {/* Pump selector — shown when multiple pumps are detected */}
              {parsedFile.pumpGradients.length > 1 && (
                <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
                  <div className="flex items-center gap-3">
                    <Label className="text-xs font-semibold whitespace-nowrap">
                      Gradient source pump:
                    </Label>
                    <Select
                      value={selectedPump || parsedFile.pumpGradients.find((pg) => pg.gradient === parsedFile.gradient)?.pumpName || "__auto__"}
                      onValueChange={(v) => setSelectedPump(v === "__auto__" ? "" : v)}
                    >
                      <SelectTrigger className="h-8 flex-1 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {parsedFile.pumpGradients.map((pg) => (
                          <SelectItem key={pg.pumpName} value={pg.pumpName} className="text-xs">
                            {pg.pumpLabel} — {pg.gradient.length} steps, max flow {Math.max(...pg.gradient.map((g) => g.flow)).toFixed(3)} mL/min
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="mt-1.5 text-[10px] text-muted-foreground">
                    This instrument method contains gradients for {parsedFile.pumpGradients.length} pumps.
                    Select the active pump to import its gradient. The idle pump (0 flow) is auto-detected and excluded by default.
                  </div>
                </div>
              )}
              {buildFieldGroups(parsedFile).map((group) => {
                const isExpanded = expandedGroups.has(group.title);
                const groupKeys = group.fields.map((f) => f.key);
                const allSelected = groupKeys.every((k) => selectedFields.has(k));
                return (
                  <div key={group.title} className="rounded-md border border-border">
                    <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
                      <button
                        onClick={() => toggleGroup(group.title)}
                        className="flex items-center gap-1 text-xs font-semibold"
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                        {group.title}
                      </button>
                      <span className="text-[10px] text-muted-foreground">({group.fields.length})</span>
                      <div className="ml-auto">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={() => toggleGroupAll(group)}
                        />
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="space-y-1 p-2">
                        {group.fields.map((field) => (
                          <label
                            key={field.key}
                            className="flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-accent/30"
                          >
                            <Checkbox
                              checked={selectedFields.has(field.key)}
                              onCheckedChange={() => toggleField(field.key)}
                              className="mt-0.5"
                            />
                            <div className="flex-1">
                              <div className="text-sm font-medium">{field.label}</div>
                              <div className="text-xs text-muted-foreground">{field.value}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyImport} disabled={selectedFields.size === 0}>
              Import {selectedFields.size} field{selectedFields.size === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NewMethodScanFields({
  scan,
  index,
  updateScan,
}: {
  scan: MsScan;
  index: number;
  updateScan: (index: number, patch: Partial<MsScan>) => void;
}) {
  const numField = (label: string, key: keyof MsScan, step = "0.1") => (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        step={step}
        value={scan[key] as number ?? ""}
        onChange={(e) => {
          const v = e.target.value === "" ? null : +e.target.value;
          updateScan(index, { [key]: v } as any);
        }}
        className="mt-0.5 h-7 text-xs"
      />
    </div>
  );

  const textField = (label: string, key: keyof MsScan) => (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Input
        value={(scan[key] as string) ?? ""}
        onChange={(e) => updateScan(index, { [key]: e.target.value || null } as any)}
        className="mt-0.5 h-7 text-xs"
      />
    </div>
  );

  const selectField = (label: string, key: keyof MsScan, options: string[]) => (
    <div>
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Select
        value={(scan[key] as string) ?? ""}
        onValueChange={(v) => updateScan(index, { [key]: v } as any)}
      >
        <SelectTrigger className="mt-0.5 h-7 text-xs">
          <SelectValue placeholder="—" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
      {numField("Start time (min)", "startTimeMin")}
      {numField("End time (min)", "endTimeMin")}
      {numField("Resolution", "orbitrapResolution", "1000")}
      <div>
        <Label className="text-[10px] text-muted-foreground">Scan range low (m/z)</Label>
        <Input
          type="number"
          value={scan.scanRangeMz?.[0] ?? ""}
          onChange={(e) => {
            const lo = e.target.value === "" ? null : +e.target.value;
            const hi = scan.scanRangeMz?.[1] ?? null;
            updateScan(index, { scanRangeMz: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">Scan range high (m/z)</Label>
        <Input
          type="number"
          value={scan.scanRangeMz?.[1] ?? ""}
          onChange={(e) => {
            const hi = e.target.value === "" ? null : +e.target.value;
            const lo = scan.scanRangeMz?.[0] ?? null;
            updateScan(index, { scanRangeMz: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      {selectField("AGC target", "agcTarget", ["Standard", "High", "Low"])}
      {numField("Microscans", "microscans", "1")}
      {numField("RF lens (%)", "rfLensPct", "1")}
      {selectField("Max IT mode", "maxInjectionTimeMode", ["Auto", "Custom"])}
      {numField("Max IT (ms)", "maxInjectionTimeMs", "1")}
      {selectField("Data type", "dataType", ["Profile", "Centroid"])}
      {selectField("Polarity", "polarity", ["Both", "Positive", "Negative"])}
      {selectField("Source fragmentation", "sourceFragmentation", ["False", "True"])}
      {textField("Scan description", "scanDescription")}
      {textField("Isolation offset", "isolationOffset")}
      {textField("Isolation window", "isolationWindow")}
      {numField("Isolation window (m/z)", "isolationWindowMz", "0.1")}
      {numField("Max multiplexed ions", "maxMultiplexedIons", "1")}
      {numField("Min intensity", "intensityThreshold", "100")}
      {textField("Dynamic exclusion", "dynamicExclusionMode")}
      {textField("Isotope exclusion", "isotopeExclusion")}
      <div>
        <Label className="text-[10px] text-muted-foreground">Precursor range low (m/z)</Label>
        <Input
          type="number"
          value={scan.precursorSelectionRange?.[0] ?? ""}
          onChange={(e) => {
            const lo = e.target.value === "" ? null : +e.target.value;
            const hi = scan.precursorSelectionRange?.[1] ?? null;
            updateScan(index, { precursorSelectionRange: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      <div>
        <Label className="text-[10px] text-muted-foreground">Precursor range high (m/z)</Label>
        <Input
          type="number"
          value={scan.precursorSelectionRange?.[1] ?? ""}
          onChange={(e) => {
            const hi = e.target.value === "" ? null : +e.target.value;
            const lo = scan.precursorSelectionRange?.[0] ?? null;
            updateScan(index, { precursorSelectionRange: lo != null && hi != null ? [lo, hi] : null });
          }}
          className="mt-0.5 h-7 text-xs"
        />
      </div>
      {textField("Reported mass", "reportedMass")}
      {textField("Scan range mode", "scanRangeMode")}
      {textField("TurboTMT", "turboTmt")}
      {selectField("Lock mass injection", "lockMassInjection", ["False", "True"])}
      {selectField("Multiplex ions", "multiplexIonsEnabled", ["False", "True"])}

      {scan.extraParams && scan.extraParams.length > 0 && (
        <div className="col-span-2 sm:col-span-3">
          <details>
            <summary className="cursor-pointer text-[10px] text-muted-foreground">
              Extra parameters ({scan.extraParams.length})
            </summary>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 sm:grid-cols-3">
              {scan.extraParams.map((p, j) => (
                <div key={j} className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground shrink-0">{p.key}:</span>
                  <Input
                    value={p.value}
                    onChange={(e) => {
                      const next = [...scan.extraParams];
                      next[j] = { ...p, value: e.target.value };
                      updateScan(index, { extraParams: next });
                    }}
                    className="h-6 flex-1 text-[10px]"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 shrink-0"
                    onClick={() => updateScan(index, { extraParams: scan.extraParams.filter((_, k) => k !== j) })}
                  >
                    <X className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

