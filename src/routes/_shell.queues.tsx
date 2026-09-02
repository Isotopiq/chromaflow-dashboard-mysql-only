import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@tanstack/react-router";
import { Plus, ListOrdered, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { upsertSampleQueue, deleteSampleQueue } from "@/lib/v3-functions";

export const Route = createFileRoute("/_shell/queues")({
  component: QueuesPage,
});

function QueuesPage() {
  const { sampleQueues, batches } = useLab();
  const upsertLocal = useLab((s) => s.upsertSampleQueueLocal);
  const removeLocal = useLab((s) => s.removeSampleQueueLocal);
  const upsertFn = useServerFn(upsertSampleQueue);
  const deleteFn = useServerFn(deleteSampleQueue);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function createQueue() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const q = await upsertFn({ data: { name: newName.trim() } });
      upsertLocal(q);
      setNewName("");
      toast.success("Queue created");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create queue");
    } finally {
      setCreating(false);
    }
  }

  async function removeQueue(id: string) {
    try {
      await deleteFn({ data: { id } });
      removeLocal(id);
      toast.success("Queue deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Workflow
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Sample queues</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create sequence tables for instrument runs. Import Xcalibur .sld files to auto-populate entries.
        </p>
      </div>

      <Card className="border-border bg-card p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="queue-name">New queue name</Label>
            <Input
              id="queue-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. EL-02132026 Kennedy Pathway"
              onKeyDown={(e) => e.key === "Enter" && createQueue()}
            />
          </div>
          <Button onClick={createQueue} disabled={creating || !newName.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Create
          </Button>
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {sampleQueues.length === 0 ? (
          <Card className="border-border bg-card p-6 text-center text-sm text-muted-foreground md:col-span-2 lg:col-span-3">
            <ListOrdered className="mx-auto mb-2 h-8 w-8 opacity-40" />
            No sample queues yet. Create one above to get started.
          </Card>
        ) : (
          sampleQueues.map((q) => {
            const batch = batches.find((b) => b.id === q.batchId);
            return (
              <Card key={q.id} className="border-border bg-card p-4">
                <div className="flex items-start justify-between">
                  <Link
                    to="/queues/$queueId"
                    params={{ queueId: q.id }}
                    className="min-w-0 flex-1 hover:underline"
                  >
                    <div className="truncate text-sm font-medium">{q.name}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {q.entries.length} entries{batch ? ` · ${batch.name}` : ""}
                    </div>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeQueue(q.id)}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
