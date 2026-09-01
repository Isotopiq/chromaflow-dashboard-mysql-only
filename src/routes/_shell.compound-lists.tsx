import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  createCompoundList,
  updateCompoundList,
  deleteCompoundList,
  createCompoundListFromCsv,
  updateCompoundListFromCsv,
} from "@/lib/lab.functions";
import { mzFromFormula } from "@/lib/chem";

export const Route = createFileRoute("/_shell/compound-lists")({
  component: CompoundLists,
});

// ---- CSV parsing (same format as analyte CSV: name,formula,rt_expected,mz) ----
type ParsedCsvRow = { name: string; formula: string; rtExpected: number; mz: number | null };

function parseCompoundCsv(text: string): { rows: ParsedCsvRow[]; errors: string[] } {
  const errors: string[] = [];
  const rows: ParsedCsvRow[] = [];
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

function CompoundLists() {
  const { analytes, compoundLists } = useLab();
  const upsertCompoundListLocal = useLab((s) => s.upsertCompoundListLocal);
  const removeCompoundListLocal = useLab((s) => s.removeCompoundListLocal);
  const createFn = useServerFn(createCompoundList);
  const updateFn = useServerFn(updateCompoundList);
  const deleteFn = useServerFn(deleteCompoundList);
  const createFromCsvFn = useServerFn(createCompoundListFromCsv);
  const updateFromCsvFn = useServerFn(updateCompoundListFromCsv);
  const qc = useQueryClient();

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // CSV import state
  const [showCsvDialog, setShowCsvDialog] = useState(false);
  const [csvEditingId, setCsvEditingId] = useState<string | null>(null);
  const [csvName, setCsvName] = useState("");
  const [csvDescription, setCsvDescription] = useState("");
  const [csvMode, setCsvMode] = useState<"replace" | "append">("replace");
  const [csvParsed, setCsvParsed] = useState<{ rows: ParsedCsvRow[]; errors: string[]; fileName: string } | null>(null);
  const [csvSaving, setCsvSaving] = useState(false);
  const csvInputRef = useRef<HTMLInputElement>(null);

  const filteredAnalytes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return analytes;
    return analytes.filter((a) =>
      a.name.toLowerCase().includes(q) || a.formula.toLowerCase().includes(q),
    );
  }, [analytes, search]);

  const openNew = () => {
    setEditingId(null);
    setName("");
    setDescription("");
    setSelectedIds(new Set());
    setSearch("");
    setShowDialog(true);
  };

  const openEdit = (id: string) => {
    const cl = compoundLists.find((x) => x.id === id);
    if (!cl) return;
    setEditingId(id);
    setName(cl.name);
    setDescription(cl.description);
    setSelectedIds(new Set(cl.analyteIds));
    setSearch("");
    setShowDialog(true);
  };

  const toggleAnalyte = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim(),
        analyteIds: Array.from(selectedIds),
      };
      if (editingId) {
        const updated = await updateFn({ data: { id: editingId, ...payload } });
        upsertCompoundListLocal(updated as any);
        toast.success("Compound list updated");
      } else {
        const created = await createFn({ data: payload });
        upsertCompoundListLocal(created as any);
        toast.success("Compound list created");
      }
      setShowDialog(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save compound list");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteFn({ data: { id: deleteId } });
      removeCompoundListLocal(deleteId);
      toast.success("Compound list deleted");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete compound list");
    } finally {
      setDeleteId(null);
    }
  };

  // ---- CSV import handlers ----
  const openCsvNew = () => {
    setCsvEditingId(null);
    setCsvName("");
    setCsvDescription("");
    setCsvMode("replace");
    setCsvParsed(null);
    setShowCsvDialog(true);
  };

  const openCsvEdit = (id: string) => {
    const cl = compoundLists.find((x) => x.id === id);
    if (!cl) return;
    setCsvEditingId(id);
    setCsvName(cl.name);
    setCsvDescription(cl.description);
    setCsvMode("replace");
    setCsvParsed(null);
    setShowCsvDialog(true);
  };

  const handleCsvFile = async (file: File) => {
    try {
      const text = await file.text();
      const { rows, errors } = parseCompoundCsv(text);
      if (errors.length && rows.length === 0) {
        toast.error(errors.slice(0, 3).join(" "));
        return;
      }
      setCsvParsed({ rows, errors, fileName: file.name });
      // Auto-fill name from filename if empty
      if (!csvName && !csvEditingId) {
        const baseName = file.name.replace(/\.csv$/i, "").replace(/[-_]/g, " ");
        setCsvName(baseName);
      }
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to read CSV file");
    }
  };

  const saveCsvImport = async () => {
    if (!csvParsed || csvParsed.rows.length === 0) {
      toast.error("No valid rows to import");
      return;
    }
    if (!csvName.trim()) {
      toast.error("List name is required");
      return;
    }
    setCsvSaving(true);
    try {
      const rowsPayload = csvParsed.rows.map((r) => ({
        name: r.name,
        formula: r.formula,
        rtExpected: r.rtExpected,
        mz: r.mz,
      }));
      if (csvEditingId) {
        const updated = await updateFromCsvFn({
          data: {
            id: csvEditingId,
            name: csvName.trim(),
            description: csvDescription.trim(),
            rows: rowsPayload,
            mode: csvMode,
          },
        });
        upsertCompoundListLocal(updated as any);
        qc.invalidateQueries({ queryKey: ["lab"] });
        toast.success(`Compound list updated — ${csvParsed.rows.length} compounds ${csvMode === "replace" ? "replaced" : "appended"}`);
      } else {
        const created = await createFromCsvFn({
          data: {
            name: csvName.trim(),
            description: csvDescription.trim(),
            rows: rowsPayload,
          },
        });
        upsertCompoundListLocal(created as any);
        qc.invalidateQueries({ queryKey: ["lab"] });
        toast.success(`Compound list created — ${csvParsed.rows.length} compounds imported`);
      }
      setShowCsvDialog(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to import CSV");
    } finally {
      setCsvSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Libraries
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Compound Lists</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create reusable compound lists for targeted peak identification during mzXML upload.
          Assign defaults per method+column pair on the method detail page.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          {compoundLists.length} list{compoundLists.length === 1 ? "" : "s"}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={openCsvNew}>
            <Upload className="mr-1 h-3.5 w-3.5" /> Import CSV
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1 h-3.5 w-3.5" /> New List
          </Button>
        </div>
      </div>

      <Card className="border-border bg-card p-4">
        {compoundLists.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No compound lists yet. Create one to target specific analytes during peak identification.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 text-[10px] uppercase">Name</TableHead>
                <TableHead className="h-8 text-[10px] uppercase">Description</TableHead>
                <TableHead className="h-8 text-[10px] uppercase">Compounds</TableHead>
                <TableHead className="h-8 text-[10px] uppercase">Created</TableHead>
                <TableHead className="h-8 w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {compoundLists.map((cl) => (
                <TableRow key={cl.id}>
                  <TableCell className="py-1.5 text-xs font-medium">{cl.name}</TableCell>
                  <TableCell className="py-1.5 text-xs max-w-[300px] truncate text-muted-foreground">
                    {cl.description || "—"}
                  </TableCell>
                  <TableCell className="py-1.5 text-xs">
                    <Badge variant="outline" className="text-[10px]">
                      {cl.analyteIds.length}
                    </Badge>
                  </TableCell>
                  <TableCell className="py-1.5 text-xs text-muted-foreground">
                    {String(cl.createdAt).slice(0, 10)}
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(cl.id)} className="text-muted-foreground hover:text-foreground" title="Edit">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => openCsvEdit(cl.id)} className="text-muted-foreground hover:text-foreground" title="Import CSV to update">
                        <Upload className="h-3 w-3" />
                      </button>
                      <button onClick={() => setDeleteId(cl.id)} className="text-muted-foreground hover:text-destructive" title="Delete">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit compound list" : "New compound list"}</DialogTitle>
            <DialogDescription>
              Select analytes from the library to include in this list.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pharma Panel A" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Description</Label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">
                Analytes ({selectedIds.size} selected)
              </Label>
              <div className="relative w-64">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search analytes…"
                  className="h-8 pl-7 text-xs"
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              {filteredAnalytes.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No analytes found.
                </div>
              ) : (
                filteredAnalytes.map((a) => (
                  <label
                    key={a.id}
                    className="flex cursor-pointer items-center gap-2 border-b border-border/50 px-3 py-1.5 last:border-0 hover:bg-accent/30"
                  >
                    <Checkbox
                      checked={selectedIds.has(a.id)}
                      onCheckedChange={() => toggleAnalyte(a.id)}
                    />
                    <span className="text-xs font-medium">{a.name}</span>
                    {a.formula && <span className="text-[10px] text-muted-foreground">{a.formula}</span>}
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                      {a.mz.toFixed(4)} · {a.rtExpected.toFixed(2)} min
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !name.trim()}>
              {saving ? "Saving…" : editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete compound list?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the list and its compound entries. Default assignments referencing this list will also be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* CSV import dialog */}
      <Dialog open={showCsvDialog} onOpenChange={setShowCsvDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {csvEditingId ? "Update list from CSV" : "Create list from CSV"}
            </DialogTitle>
            <DialogDescription>
              Upload a CSV file (columns: name, formula, rt_expected, mz) to
              {csvEditingId ? " update this compound list." : " create a new compound list."}
              {" "}Compounds are auto-created in the analyte library if they don't already exist.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">List name</Label>
              <Input value={csvName} onChange={(e) => setCsvName(e.target.value)} placeholder="e.g. Luna Standards" />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">Description (optional)</Label>
              <Input value={csvDescription} onChange={(e) => setCsvDescription(e.target.value)} placeholder="Optional description" />
            </div>
            {csvEditingId && (
              <div className="grid gap-1.5">
                <Label className="text-xs">Import mode</Label>
                <Select value={csvMode} onValueChange={(v) => setCsvMode(v as "replace" | "append")}>
                  <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="replace">Replace all compounds</SelectItem>
                    <SelectItem value="append">Append to existing compounds</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-1.5">
              <Label className="text-xs">CSV file</Label>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsvFile(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => csvInputRef.current?.click()}
              >
                <Upload className="mr-1 h-3.5 w-3.5" />
                {csvParsed ? `Loaded: ${csvParsed.fileName}` : "Choose CSV file…"}
              </Button>
            </div>
            {csvParsed && (
              <div className="rounded-md border border-border p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {csvParsed.rows.length} valid compound{csvParsed.rows.length === 1 ? "" : "s"}
                  </span>
                  {csvParsed.errors.length > 0 && (
                    <span className="text-destructive">
                      {csvParsed.errors.length} row(s) skipped
                    </span>
                  )}
                </div>
                {csvParsed.errors.length > 0 && (
                  <div className="mt-1 max-h-20 overflow-y-auto text-[10px] text-muted-foreground">
                    {csvParsed.errors.slice(0, 5).map((e, i) => (
                      <div key={i}>{e}</div>
                    ))}
                    {csvParsed.errors.length > 5 && <div>…and {csvParsed.errors.length - 5} more</div>}
                  </div>
                )}
                {csvParsed.rows.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="h-6 text-[9px] uppercase">Name</TableHead>
                          <TableHead className="h-6 text-[9px] uppercase">Formula</TableHead>
                          <TableHead className="h-6 text-[9px] uppercase">RT</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {csvParsed.rows.slice(0, 20).map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="py-0.5 text-[10px] font-medium">{r.name}</TableCell>
                            <TableCell className="py-0.5 text-[10px] text-muted-foreground">{r.formula || "—"}</TableCell>
                            <TableCell className="py-0.5 text-[10px] font-mono">{r.rtExpected.toFixed(2)}</TableCell>
                          </TableRow>
                        ))}
                        {csvParsed.rows.length > 20 && (
                          <TableRow>
                            <TableCell colSpan={3} className="py-0.5 text-[10px] text-muted-foreground">
                              …and {csvParsed.rows.length - 20} more
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCsvDialog(false)}>Cancel</Button>
            <Button
              onClick={saveCsvImport}
              disabled={csvSaving || !csvName.trim() || !csvParsed || csvParsed.rows.length === 0}
            >
              {csvSaving ? "Importing…" : csvEditingId ? "Update list" : "Create list"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
