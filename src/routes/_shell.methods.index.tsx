import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { StatusDot } from "@/components/status-dot";
import { Plus, Trash2, Archive } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
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
import { deleteMethod, archiveMethod } from "@/lib/lab.functions";
import type { Method } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/methods/")({
  component: MethodsList,
});

function MethodsList() {
  const { methods, columns, runs, currentUser, removeMethodLocal, archiveMethodLocal } = useLab();
  const deleteFn = useServerFn(deleteMethod);
  const archiveFn = useServerFn(archiveMethod);
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [modality, setModality] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<Method | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<Method | null>(null);
  const [archiving, setArchiving] = useState(false);

  const isAdmin = currentUser?.role === "admin";

  const filtered = useMemo(
    () =>
      methods.filter(
        (m) =>
          (modality === "all" || m.modality === modality) &&
          (q === "" ||
            m.name.toLowerCase().includes(q.toLowerCase()) ||
            m.tags.some((t) => t.toLowerCase().includes(q.toLowerCase()))),
      ),
    [methods, q, modality],
  );

  const modalities = ["all", ...Array.from(new Set(methods.map((m) => m.modality)))];

  const canDelete = (m: Method) => isAdmin || !m.createdBy || m.createdBy === currentUser?.id;

  const confirmDelete = async (force: boolean) => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await deleteFn({ data: { methodId: deleteTarget.id, force } });
      if (res.missing) {
        toast.info("Method no longer exists");
      } else {
        removeMethodLocal(deleteTarget.id);
        toast.success(`Method "${deleteTarget.name}" deleted`);
      }
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete method");
    } finally {
      setDeleting(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const res = await archiveFn({ data: { methodId: archiveTarget.id } });
      if (res.missing) {
        toast.info("Method no longer exists");
      } else {
        archiveMethodLocal(archiveTarget.id);
        toast.success(`Method "${archiveTarget.name}" archived`);
      }
      setArchiveTarget(null);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to archive method");
    } finally {
      setArchiving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Method development log
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Methods</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every chromatographic method, with parameters, run history and revisions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/methods/compare">Compare</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/methods/new">
              <Plus className="mr-1 h-3.5 w-3.5" /> New method
            </Link>
          </Button>
        </div>
      </div>

      <Card className="border-border bg-card p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Input
            placeholder="Search by name or tag…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 max-w-xs text-xs"
          />
          <div className="flex gap-1">
            {modalities.map((m) => (
              <Button
                key={m}
                size="sm"
                variant={modality === m ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => setModality(m)}
              >
                {m}
              </Button>
            ))}
          </div>
          <div className="ml-auto font-mono text-[10px] text-muted-foreground">
            {filtered.length} of {methods.length}
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead className="text-[10px] uppercase tracking-wider">Method</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Modality</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Column</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Runs</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Tags</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Status</TableHead>
              <TableHead className="text-[10px] uppercase tracking-wider">Updated</TableHead>
              <TableHead className="w-20 text-[10px] uppercase tracking-wider">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => {
              const col = columns.find((c) => c.id === m.columnId);
              const runCount = runs.filter((r) => r.methodId === m.id).length;
              const canDel = canDelete(m);
              return (
                <TableRow key={m.id} className="text-xs">
                  <TableCell>
                    <Link
                      to="/methods/$methodId"
                      params={{ methodId: m.id }}
                      className="font-medium hover:text-primary"
                    >
                      {m.name}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-[11px]">{m.modality}</TableCell>
                  <TableCell className="text-muted-foreground">{col?.name ?? "—"}</TableCell>
                  <TableCell className="font-mono">{runCount}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {m.tags.slice(0, 3).map((t) => (
                        <Badge
                          key={t}
                          variant="outline"
                          className="text-[10px] font-normal text-muted-foreground"
                        >
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StatusDot status={m.status} />
                      <span className="capitalize">{m.status}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground">
                    {new Date(m.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {m.status !== "archived" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Archive"
                          disabled={!canDel}
                          onClick={() => setArchiveTarget(m)}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        title="Delete"
                        disabled={!canDel}
                        onClick={() => setDeleteTarget(m)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete method "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && runs.some((r) => r.methodId === deleteTarget.id) ? (
                <>
                  This method is linked to {runs.filter((r) => r.methodId === deleteTarget.id).length} run(s).
                  Deleting will unlink those runs (their method reference will be cleared).
                  This cannot be undone. Consider archiving instead if you want to preserve the record.
                </>
              ) : (
                <>This will permanently delete the method. This cannot be undone.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={() => confirmDelete(true)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Archive confirmation */}
      <AlertDialog open={!!archiveTarget} onOpenChange={(v) => !v && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive method "{archiveTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The method will be marked as archived and hidden from active lists.
              You can still find it by filtering. This can be undone by editing the method.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={archiving}
              onClick={confirmArchive}
            >
              {archiving ? "Archiving…" : "Archive"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
