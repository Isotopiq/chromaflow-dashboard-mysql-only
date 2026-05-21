import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useEffect, useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Download, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { addAnalyte, updateAnalyte, deleteAnalyte } from "@/lib/lab.functions";
import { monoisotopicMass, mzFromFormula } from "@/lib/chem";
import type { Analyte } from "@/lib/mock-data";
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
  const { analytes } = useLab();
  const userOwned = analytes.filter((a) => a.librarySource === "user").length;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Compound library
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Analytes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage the compounds used for Auto-XIC and peak annotation —{" "}
          {analytes.length} total ({userOwned} of yours).
        </p>
      </div>

      <Tabs defaultValue="library">
        <TabsList>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="matrix">RT matrix</TabsTrigger>
        </TabsList>
        <TabsContent value="library" className="mt-4">
          <LibraryTab />
        </TabsContent>
        <TabsContent value="matrix" className="mt-4">
          <MatrixTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Library tab
// ---------------------------------------------------------------------------

function LibraryTab() {
  const { analytes, currentUser } = useLab();
  const addLocal = useLab((s) => s.addAnalyteLocal);
  const updateLocal = useLab((s) => s.updateAnalyteLocal);
  const removeLocal = useLab((s) => s.removeAnalyteLocal);
  const addFn = useServerFn(addAnalyte);
  const updateFn = useServerFn(updateAnalyte);
  const deleteFn = useServerFn(deleteAnalyte);
  const qc = useQueryClient();

  const [editing, setEditing] = useState<Analyte | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const sorted = useMemo(
    () =>
      [...analytes].sort((a, b) => {
        // user-owned first, then alphabetical
        const ao = a.librarySource === "user" ? 0 : 1;
        const bo = b.librarySource === "user" ? 0 : 1;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      }),
    [analytes],
  );

  const selectable = useMemo(
    () =>
      sorted.filter(
        (a) => !a.createdBy || a.createdBy === currentUser.id || a.librarySource === "user",
      ),
    [sorted, currentUser.id],
  );
  const allSelected = selectable.length > 0 && selectable.every((a) => selected.has(a.id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(on: boolean) {
    setSelected(on ? new Set(selectable.map((a) => a.id)) : new Set());
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkDeleting(true);
    let ok = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteFn({ data: { id } });
        removeLocal(id);
        ok++;
      } catch (e) {
        failed++;
        console.error("Bulk delete failed", id, e);
      }
    }
    qc.invalidateQueries({ queryKey: ["lab"] });
    setSelected(new Set());
    setBulkDeleting(false);
    if (ok) toast.success(`Deleted ${ok} compound${ok === 1 ? "" : "s"}${failed ? ` (${failed} failed)` : ""}.`);
    else toast.error("No compounds deleted.");
  }


  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          Add compounds, edit library entries, or open a compound to compare it across columns.
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={downloadCsvTemplate}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV template
          </Button>
          <CsvImportButton
            onImported={(saved) => {
              for (const a of saved) addLocal(a);
              qc.invalidateQueries({ queryKey: ["lab"] });
            }}
            addFn={addFn}
          />
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add compound
              </Button>
            </DialogTrigger>
            <CompoundFormDialog
              title="Add compound"
              initial={null}
              onSubmit={async (vals) => {
                try {
                  const saved = await addFn({ data: vals });
                  addLocal(saved);
                  qc.invalidateQueries({ queryKey: ["lab"] });
                  toast.success(`Added ${saved.name}`);
                  setCreating(false);
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed to add compound");
                  throw e;
                }
              }}
            />
          </Dialog>
        </div>
      </div>

      <Card className="border-border bg-card p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30 hover:bg-muted/30">
                <TableHead className="text-[10px] uppercase tracking-wider">Name</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Formula</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Neutral mass</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">[M+H]⁺</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">[M−H]⁻</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">RT exp</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Source</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((a) => {
                const mass = a.formula ? monoisotopicMass(a.formula) : null;
                const mzPos = a.formula ? mzFromFormula(a.formula, "[M+H]+") : null;
                const mzNeg = a.formula ? mzFromFormula(a.formula, "[M-H]-") : null;
                const isUser = a.librarySource === "user";
                const canManage = !a.createdBy || a.createdBy === currentUser.id || isUser;
                return (
                  <TableRow key={a.id} className="text-xs">
                    <TableCell className="font-medium">
                      <Link
                        to="/analytes/$analyteId"
                        params={{ analyteId: a.id }}
                        className="hover:underline hover:text-primary"
                      >
                        {a.name}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {a.formula || "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {mass != null ? mass.toFixed(4) : "—"}
                    </TableCell>
                    <TableCell className="font-mono">
                      {mzPos != null ? mzPos.toFixed(4) : a.mz.toFixed(4)}
                    </TableCell>
                    <TableCell className="font-mono">
                      {mzNeg != null ? mzNeg.toFixed(4) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {a.rtExpected.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={isUser ? "default" : "outline"} className="text-[10px]">
                        {isUser ? "yours" : "system"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Dialog
                          open={editing?.id === a.id}
                          onOpenChange={(o) => setEditing(o ? a : null)}
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              disabled={!canManage}
                              aria-label={`Edit ${a.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </DialogTrigger>
                          {editing?.id === a.id && (
                            <CompoundFormDialog
                              title={`Edit ${a.name}`}
                              initial={a}
                              onSubmit={async (vals) => {
                                try {
                                  const saved = await updateFn({ data: { ...vals, id: a.id } });
                                  updateLocal(saved);
                                  qc.invalidateQueries({ queryKey: ["lab"] });
                                  toast.success(`Updated ${saved.name}`);
                                  setEditing(null);
                                } catch (e: any) {
                                  toast.error(e?.message ?? "Failed to update compound");
                                  throw e;
                                }
                              }}
                            />
                          )}
                        </Dialog>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              disabled={!canManage}
                              aria-label={`Delete ${a.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete {a.name}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Removes this compound from your library. Existing peak
                                annotations are kept.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={async () => {
                                  try {
                                    await deleteFn({ data: { id: a.id } });
                                    removeLocal(a.id);
                                    qc.invalidateQueries({ queryKey: ["lab"] });
                                    toast.success(`Deleted ${a.name}`);
                                  } catch (e: any) {
                                    toast.error(e?.message ?? "Failed to delete");
                                  }
                                }}
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

type FormVals = {
  name: string;
  formula: string;
  rtExpected: number;
  mz?: number | null;
};

function CompoundFormDialog({
  title,
  initial,
  onSubmit,
}: {
  title: string;
  initial: Analyte | null;
  onSubmit: (vals: FormVals) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [formula, setFormula] = useState(initial?.formula ?? "");
  const [rtExpected, setRtExpected] = useState<string>(
    initial?.rtExpected != null ? String(initial.rtExpected) : "",
  );
  const [mzOverride, setMzOverride] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(initial?.name ?? "");
    setFormula(initial?.formula ?? "");
    setRtExpected(initial?.rtExpected != null ? String(initial.rtExpected) : "");
    setMzOverride("");
  }, [initial]);

  const mass = formula ? monoisotopicMass(formula) : null;
  const mzPos = formula ? mzFromFormula(formula, "[M+H]+") : null;
  const mzNeg = formula ? mzFromFormula(formula, "[M-H]-") : null;
  const formulaInvalid = formula.length > 0 && mass == null;
  const mzNum = mzOverride.trim() ? parseFloat(mzOverride) : NaN;
  const hasMz = Number.isFinite(mzNum) && mzNum > 0;
  const rtNum = parseFloat(rtExpected);
  const canSave =
    !!name.trim() &&
    Number.isFinite(rtNum) &&
    rtNum >= 0 &&
    rtNum <= 120 &&
    (mzPos != null || hasMz) &&
    !busy;

  async function submit() {
    if (!canSave) return;
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(),
        formula: formula.trim(),
        rtExpected: rtNum,
        mz: hasMz ? mzNum : null,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          m/z is computed from the molecular formula. Provide a manual override only if
          you know the measured value.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="cf-name" className="text-xs">Name</Label>
          <Input
            id="cf-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Caffeine"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cf-formula" className="text-xs">Molecular formula</Label>
          <Input
            id="cf-formula"
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder="e.g. C8H10N4O2"
            className={`h-8 font-mono text-xs ${formulaInvalid ? "border-destructive" : ""}`}
          />
          {formulaInvalid && (
            <div className="text-[10px] text-destructive">
              Couldn't parse formula. Use Hill notation (C, H, N, O, …).
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="cf-rt" className="text-xs">Expected RT (min)</Label>
            <Input
              id="cf-rt"
              value={rtExpected}
              onChange={(e) => setRtExpected(e.target.value)}
              placeholder="0.00"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cf-mz" className="text-xs">Manual m/z (optional)</Label>
            <Input
              id="cf-mz"
              value={mzOverride}
              onChange={(e) => setMzOverride(e.target.value)}
              placeholder={mzPos != null ? mzPos.toFixed(4) : "—"}
              className="h-8 font-mono text-xs"
            />
          </div>
        </div>
        <div className="rounded-md border border-border bg-muted/30 p-2 text-[11px]">
          <div className="grid grid-cols-3 gap-2 font-mono">
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">Mass</div>
              <div>{mass != null ? mass.toFixed(4) : "—"}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">[M+H]⁺</div>
              <div>{mzPos != null ? mzPos.toFixed(4) : "—"}</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-widest text-muted-foreground">[M−H]⁻</div>
              <div>{mzNeg != null ? mzNeg.toFixed(4) : "—"}</div>
            </div>
          </div>
        </div>
      </div>
      <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-end">
        {!canSave && !busy && (
          <div className="text-[10px] text-muted-foreground sm:mr-auto">
            {!name.trim()
              ? "Name required."
              : !Number.isFinite(rtNum) || rtNum < 0 || rtNum > 120
                ? "Expected RT must be 0–120 min."
                : mzPos == null && !hasMz
                  ? "Provide a valid molecular formula or a manual m/z."
                  : ""}
          </div>
        )}
        <Button onClick={submit} disabled={!canSave}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ---------------------------------------------------------------------------
// Matrix tab (kept from previous version)
// ---------------------------------------------------------------------------

function MatrixTab() {
  const { analytes, runs, methods } = useLab();
  const [selected, setSelected] = useState<string[]>(analytes.slice(0, 5).map((a) => a.id));

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

  const allAreas = matrix.flatMap((r) => r.cells.map((c) => c.meanArea ?? 0));
  const maxArea = Math.max(...allAreas, 1);

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
    <div className="flex flex-col gap-4">
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

// ---------------------------------------------------------------------------
// CSV import / template
// ---------------------------------------------------------------------------

const CSV_TEMPLATE = `name,formula,rt_expected,mz
Caffeine,C8H10N4O2,3.42,
Acetaminophen,C8H9NO2,2.10,
Custom analyte,,5.50,250.1438
`;

function downloadCsvTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "analyte-library-template.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type ParsedRow = { name: string; formula: string; rtExpected: number; mz: number | null };

function parseAnalyteCsv(text: string): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: ParsedRow[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { rows, errors: ["File is empty."] };

  const splitCsv = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQ = false;
        else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };

  const header = splitCsv(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const idx = {
    name: header.indexOf("name"),
    formula: header.indexOf("formula"),
    rt: header.findIndex((h) => h === "rt_expected" || h === "rt" || h === "rtexpected"),
    mz: header.indexOf("mz"),
  };
  if (idx.name < 0) errors.push("Missing required 'name' column.");
  if (idx.rt < 0) errors.push("Missing required 'rt_expected' column.");
  if (errors.length) return { rows, errors };

  for (let li = 1; li < lines.length; li++) {
    const cols = splitCsv(lines[li]);
    const name = (cols[idx.name] ?? "").trim();
    const formula = idx.formula >= 0 ? (cols[idx.formula] ?? "").trim() : "";
    const rtRaw = (cols[idx.rt] ?? "").trim();
    const mzRaw = idx.mz >= 0 ? (cols[idx.mz] ?? "").trim() : "";
    if (!name) { errors.push(`Row ${li + 1}: missing name.`); continue; }
    const rt = parseFloat(rtRaw);
    if (!Number.isFinite(rt) || rt < 0 || rt > 120) {
      errors.push(`Row ${li + 1} (${name}): rt_expected must be 0–120.`); continue;
    }
    const mzNum = mzRaw ? parseFloat(mzRaw) : NaN;
    const hasMz = Number.isFinite(mzNum) && mzNum > 0;
    const mzPos = formula ? mzFromFormula(formula, "[M+H]+") : null;
    if (mzPos == null && !hasMz) {
      errors.push(`Row ${li + 1} (${name}): provide a valid formula or numeric mz.`); continue;
    }
    rows.push({ name, formula, rtExpected: rt, mz: hasMz ? mzNum : null });
  }
  return { rows, errors };
}

function CsvImportButton({
  addFn,
  onImported,
}: {
  addFn: (args: { data: ParsedRow }) => Promise<Analyte>;
  onImported: (saved: Analyte[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const text = await file.text();
      const { rows, errors } = parseAnalyteCsv(text);
      if (errors.length && rows.length === 0) {
        toast.error(errors.slice(0, 3).join(" "));
        return;
      }
      if (errors.length) {
        toast.warning(`${errors.length} row(s) skipped. Importing ${rows.length}…`);
      }
      const saved: Analyte[] = [];
      let failed = 0;
      for (const r of rows) {
        try {
          const s = await addFn({ data: r });
          saved.push(s);
        } catch (e: any) {
          failed++;
          console.error("Import row failed", r, e);
        }
      }
      if (saved.length) {
        onImported(saved);
        toast.success(`Imported ${saved.length} compound${saved.length === 1 ? "" : "s"}${failed ? ` (${failed} failed)` : ""}.`);
      } else {
        toast.error("No compounds imported.");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to read file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        <Upload className="mr-1 h-3.5 w-3.5" />
        {busy ? "Importing…" : "Import CSV"}
      </Button>
    </>
  );
}

