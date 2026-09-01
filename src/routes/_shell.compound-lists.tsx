import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
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
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { toast } from "sonner";
import {
  createCompoundList,
  updateCompoundList,
  deleteCompoundList,
} from "@/lib/lab.functions";

export const Route = createFileRoute("/_shell/compound-lists")({
  component: CompoundLists,
});

function CompoundLists() {
  const { analytes, compoundLists } = useLab();
  const upsertCompoundListLocal = useLab((s) => s.upsertCompoundListLocal);
  const removeCompoundListLocal = useLab((s) => s.removeCompoundListLocal);
  const createFn = useServerFn(createCompoundList);
  const updateFn = useServerFn(updateCompoundList);
  const deleteFn = useServerFn(deleteCompoundList);

  const [showDialog, setShowDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-3.5 w-3.5" /> New List
        </Button>
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
                      <button onClick={() => openEdit(cl.id)} className="text-muted-foreground hover:text-foreground">
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button onClick={() => setDeleteId(cl.id)} className="text-muted-foreground hover:text-destructive">
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
    </div>
  );
}
