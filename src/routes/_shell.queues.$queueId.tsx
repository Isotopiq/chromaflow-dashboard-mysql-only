import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useMemo } from "react";
import { useLab } from "@/lib/store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Upload, Plus, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  upsertSampleQueueEntry, deleteSampleQueueEntry, importSldToQueue,
} from "@/lib/v3-functions";
import type { SampleQueueEntry } from "@/lib/lab-types";

export const Route = createFileRoute("/_shell/queues/$queueId")({
  component: QueueDetailGate,
});

function QueueDetailGate() {
  const { queueId } = Route.useParams();
  const { sampleQueues, hydrated } = useLab();
  const queue = sampleQueues.find((q) => q.id === queueId);
  if (!queue) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {hydrated ? "Queue not found." : "Loading…"}
      </div>
    );
  }
  return <QueueDetail queue={queue} />;
}

function QueueDetail({ queue }: { queue: any }) {
  const { methods, columns, batches } = useLab();
  const upsertLocal = useLab((s) => s.upsertSampleQueueLocal);
  const upsertEntryFn = useServerFn(upsertSampleQueueEntry);
  const deleteEntryFn = useServerFn(deleteSampleQueueEntry);
  const importSldFn = useServerFn(importSldToQueue);
  const fileRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<SampleQueueEntry[]>(queue.entries ?? []);
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  async function handleSldUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const res = await importSldFn({ data: { queueId: queue.id, fileData: buf } });
      toast.success(`Imported ${res.imported} of ${res.total} entries from .sld file.`);
      // Refresh entries from store
      const updated = await upsertEntryFn({ data: { queueId: queue.id, position: 0, sampleName: "__refresh__" } }).catch(() => null);
      // Best to invalidate queries — but for now just reload
      window.location.reload();
    } catch (e: any) {
      toast.error(e?.message ?? "SLD import failed");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function addEntry() {
    const pos = entries.length > 0 ? Math.max(...entries.map((e) => e.position)) + 1 : 1;
    try {
      const entry = await upsertEntryFn({
        data: {
          queueId: queue.id,
          position: pos,
          sampleName: `Sample ${pos}`,
          sampleType: "unknown",
        },
      });
      setEntries([...entries, entry]);
      toast.success("Entry added");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add entry");
    }
  }

  async function updateEntry(idx: number, field: keyof SampleQueueEntry, value: any) {
    const entry = entries[idx];
    const updated = { ...entry, [field]: value };
    setEntries(entries.map((e, i) => (i === idx ? updated : e)));
  }

  async function saveEntry(idx: number) {
    const entry = entries[idx];
    setSaving(entry.id);
    try {
      const saved = await upsertEntryFn({
        data: {
          id: entry.id,
          queueId: entry.queueId,
          position: entry.position,
          sampleName: entry.sampleName,
          sampleType: entry.sampleType,
          vialPosition: entry.vialPosition,
          trayCode: entry.trayCode,
          methodPath: entry.methodPath,
          methodId: entry.methodId,
          columnId: entry.columnId,
          injectionVolume: entry.injectionVolume,
          dilutionFactor: entry.dilutionFactor,
        },
      });
      setEntries(entries.map((e, i) => (i === idx ? saved : e)));
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSaving(null);
    }
  }

  async function removeEntry(id: string) {
    try {
      await deleteEntryFn({ data: { id } });
      setEntries(entries.filter((e) => e.id !== id));
      toast.success("Entry deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <Link
        to="/queues"
        className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> All queues
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{queue.name}</h1>
          <p className="text-sm text-muted-foreground">
            {entries.length} entries{queue.instrument ? ` · ${queue.instrument}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".sld"
            className="hidden"
            onChange={handleSldUpload}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={importing}
          >
            <Upload className="mr-1 h-4 w-4" />
            {importing ? "Importing…" : "Import .sld"}
          </Button>
          <Button size="sm" onClick={addEntry}>
            <Plus className="mr-1 h-4 w-4" /> Add entry
          </Button>
        </div>
      </div>

      <Card className="border-border bg-card p-4">
        {entries.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No entries yet. Import an .sld file or add entries manually.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Sample name</TableHead>
                  <TableHead className="w-28">Type</TableHead>
                  <TableHead className="w-24">Vial</TableHead>
                  <TableHead className="w-24">Tray</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="w-24">Volume (µL)</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, idx) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-xs">{entry.position}</TableCell>
                    <TableCell>
                      <Input
                        value={entry.sampleName}
                        onChange={(e) => updateEntry(idx, "sampleName", e.target.value)}
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={entry.sampleType}
                        onValueChange={(v) => updateEntry(idx, "sampleType", v)}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unknown">Unknown</SelectItem>
                          <SelectItem value="blank">Blank</SelectItem>
                          <SelectItem value="standard">Standard</SelectItem>
                          <SelectItem value="qc">QC</SelectItem>
                          <SelectItem value="double_blank">Double blank</SelectItem>
                          <SelectItem value="system_suitability">SST</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        value={entry.vialPosition}
                        onChange={(e) => updateEntry(idx, "vialPosition", e.target.value)}
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={entry.trayCode}
                        onChange={(e) => updateEntry(idx, "trayCode", e.target.value)}
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={entry.methodId ?? ""}
                        onValueChange={(v) => updateEntry(idx, "methodId", v || null)}
                      >
                        <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">None</SelectItem>
                          {methods.map((m) => (
                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={entry.injectionVolume}
                        onChange={(e) => updateEntry(idx, "injectionVolume", Number(e.target.value))}
                        className="h-7 text-xs"
                      />
                    </TableCell>
                    <TableCell>
                      <span className={`text-[10px] font-medium ${
                        entry.status === "complete" ? "text-green-600" :
                        entry.status === "running" ? "text-blue-600" :
                        entry.status === "failed" ? "text-red-600" :
                        "text-muted-foreground"
                      }`}>
                        {entry.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => saveEntry(idx)}
                          disabled={saving === entry.id}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeEntry(entry.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
