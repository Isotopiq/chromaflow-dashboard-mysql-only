import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteBatch, upsertBatch } from "@/lib/lab.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export const Route = createFileRoute("/_shell/batches")({
  component: Batches,
});

function Batches() {
  const { batches, runs, users } = useLab();
  const removeBatchLocal = useLab((s) => s.removeBatchLocal);
  const removeRunLocal = useLab((s) => s.removeRunLocal);
  const upsertBatchLocal = useLab((s) => s.upsertBatchLocal);
  const deleteBatchFn = useServerFn(deleteBatch);
  const upsertBatchFn = useServerFn(upsertBatch);
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [project, setProject] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const b = await upsertBatchFn({ data: { name: name.trim(), project: project.trim() } });
      upsertBatchLocal(b);
      qc.invalidateQueries({ queryKey: ["lab"] });
      toast.success(`Created batch ${b.name}`);
      setOpen(false);
      setName("");
      setProject("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create batch");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Inventory
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Batches</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Group runs and methods into experiments and release lots.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-1 h-3.5 w-3.5" /> New batch
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New batch</DialogTitle>
              <DialogDescription>
                Create a batch to group related runs and methods.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="batch-name">Name</Label>
                <Input
                  id="batch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. QC-2026-06"
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="batch-project">Project</Label>
                <Input
                  id="batch-project"
                  value={project}
                  onChange={(e) => setProject(e.target.value)}
                  placeholder="Optional project tag"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? "Creating…" : "Create batch"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {batches.map((b) => {
          const owner = users.find((u) => u.id === b.owner);
          const batchRuns = runs.filter((r) => r.batchId === b.id);
          return (
            <BatchCard
              key={b.id}
              batch={b}
              ownerAvatar={owner?.avatar ?? "—"}
              batchRuns={batchRuns}
              onDelete={async (deleteRuns) => {
                try {
                  await deleteBatchFn({
                    data: { batchId: b.id, deleteRuns },
                  });
                  if (deleteRuns) {
                    for (const r of batchRuns) removeRunLocal(r.id);
                  }
                  removeBatchLocal(b.id);
                  qc.invalidateQueries({ queryKey: ["lab"] });
                  toast.success(`Deleted batch ${b.name}`);
                } catch (e: any) {
                  toast.error(e?.message ?? "Failed to delete batch");
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function BatchCard({
  batch,
  ownerAvatar,
  batchRuns,
  onDelete,
}: {
  batch: any;
  ownerAvatar: string;
  batchRuns: any[];
  onDelete: (deleteRuns: boolean) => Promise<void>;
}) {
  const [cascade, setCascade] = useState(false);

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">{batch.name}</div>
          <div className="text-[11px] text-muted-foreground">{batch.project}</div>
        </div>
        <div className="flex items-center gap-1">
          <Badge variant="outline" className="text-[10px]">
            <StatusDot status={batch.status} className="mr-1" />
            {batch.status.replace("_", " ")}
          </Badge>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                aria-label={`Delete ${batch.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete batch?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently deletes <span className="font-mono">{batch.name}</span>.
                  {batchRuns.length > 0 ? (
                    <>
                      {" "}It currently contains {batchRuns.length} run
                      {batchRuns.length === 1 ? "" : "s"}.
                    </>
                  ) : null}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {batchRuns.length > 0 && (
                <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
                  <Checkbox
                    checked={cascade}
                    onCheckedChange={(v) => setCascade(v === true)}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium">
                      Also delete the {batchRuns.length} run
                      {batchRuns.length === 1 ? "" : "s"} in this batch
                    </div>
                    <div className="text-muted-foreground">
                      Otherwise the runs are kept and unlinked from the batch.
                    </div>
                  </div>
                </label>
              )}
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(cascade)}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Samples" value={String(batch.sampleCount)} />
        <Stat label="Runs" value={String(batchRuns.length)} />
        <Stat label="Owner" value={ownerAvatar} />
      </div>

      <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
        Runs
      </div>
      <div className="mt-2 space-y-1">
        {batchRuns.slice(0, 4).map((r) => (
          <Link
            key={r.id}
            to="/runs/$runId"
            params={{ runId: r.id }}
            className="block truncate rounded-md px-2 py-1 font-mono text-[11px] hover:bg-accent/40"
          >
            {r.name}
          </Link>
        ))}
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-elevated p-2">
      <div className="font-mono text-sm">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground">{label}</div>
    </div>
  );
}
