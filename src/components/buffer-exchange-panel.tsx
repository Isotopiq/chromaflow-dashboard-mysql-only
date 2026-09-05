import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Droplets, FlaskRound, Trash2 } from "lucide-react";
import { useLab } from "@/lib/store";
import type { Column, BufferExchangeEvent, Batch } from "@/lib/lab-types";
import {
  listBufferExchangeEvents, logBufferExchange, deleteBufferExchangeEvent,
} from "@/lib/v3-functions";

type Kind = BufferExchangeEvent["kind"];

const KIND_LABEL: Record<Kind, string> = {
  buffer_a: "Buffer A change",
  buffer_b: "Buffer B change",
  both: "Both buffers changed",
  solvent_lot: "Solvent lot change",
  mobile_phase_prep: "Mobile phase prep",
};

const KIND_ICON: Record<Kind, React.ReactNode> = {
  buffer_a: <Droplets className="h-3.5 w-3.5" />,
  buffer_b: <Droplets className="h-3.5 w-3.5" />,
  both: <Droplets className="h-3.5 w-3.5" />,
  solvent_lot: <FlaskRound className="h-3.5 w-3.5" />,
  mobile_phase_prep: <FlaskRound className="h-3.5 w-3.5" />,
};

export function BufferExchangePanel({ column }: { column: Column }) {
  const { batches, currentUser, upsertBufferExchangeEventLocal, removeBufferExchangeEventLocal } = useLab();
  const isAdmin = currentUser?.role === "admin";
  const listFn = useServerFn(listBufferExchangeEvents);
  const logFn = useServerFn(logBufferExchange);
  const delFn = useServerFn(deleteBufferExchangeEvent);

  const [events, setEvents] = useState<BufferExchangeEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<Kind>("buffer_a");
  const [oldDesc, setOldDesc] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [oldLot, setOldLot] = useState("");
  const [newLot, setNewLot] = useState("");
  const [reason, setReason] = useState("");
  const [batchId, setBatchId] = useState<string>("__none__");

  const load = async () => {
    try {
      const rows = await listFn({ data: { columnId: column.id } });
      setEvents(rows);
      setLoadError(null);
    } catch (err: any) {
      setEvents([]);
      setLoadError(err?.message ?? "Could not load buffer exchange history");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.id]);

  const openFor = (k: Kind) => {
    setKind(k);
    setOldDesc("");
    setNewDesc("");
    setOldLot("");
    setNewLot("");
    setReason("");
    setBatchId("__none__");
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await logFn({
        data: {
          columnId: column.id,
          batchId: batchId !== "__none__" ? batchId : null,
          kind, oldDescription: oldDesc, newDescription: newDesc,
          oldLot, newLot, reason,
        },
      });
      upsertBufferExchangeEventLocal(res);
      setEvents((prev) => [res, ...(prev ?? [])]);
      toast.success(`Logged ${KIND_LABEL[kind]}`);
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to record buffer exchange");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await delFn({ data: { id } });
      removeBufferExchangeEventLocal(id);
      setEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete entry");
    }
  };

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Buffer & mobile-phase log
          </div>
          <h2 className="text-sm font-semibold">Track buffer exchanges & solvent lot changes</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openFor("buffer_a")}>
            <Droplets className="mr-1 h-3.5 w-3.5" /> Buffer A
          </Button>
          <Button size="sm" variant="outline" onClick={() => openFor("buffer_b")}>
            <Droplets className="mr-1 h-3.5 w-3.5" /> Buffer B
          </Button>
          <Button size="sm" onClick={() => openFor("mobile_phase_prep")}>
            <FlaskRound className="mr-1 h-3.5 w-3.5" /> Mobile phase prep
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        {loadError && (
          <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
            {loadError}
          </div>
        )}
        {!loadError && events == null && (
          <div className="text-xs text-muted-foreground">Loading history…</div>
        )}
        {!loadError && events && events.length === 0 && (
          <div className="text-xs text-muted-foreground">
            No buffer exchanges recorded yet.
          </div>
        )}
        {(events ?? []).map((ev) => (
          <div
            key={ev.id}
            className="flex items-start justify-between gap-3 rounded-md px-2 py-2 text-xs hover:bg-accent/40"
          >
            <div className="flex min-w-0 items-start gap-2">
              <span className="mt-0.5 text-muted-foreground">{KIND_ICON[ev.kind]}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{KIND_LABEL[ev.kind]}</span>
                  {(ev.oldDescription || ev.newDescription) && (
                    <Badge variant="outline" className="text-[10px]">
                      {ev.oldDescription || "—"} → {ev.newDescription || "—"}
                    </Badge>
                  )}
                  {(ev.oldLot || ev.newLot) && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      lot {ev.oldLot || "—"} → {ev.newLot || "—"}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(ev.createdAt).toLocaleString()}
                </div>
                {ev.reason && <p className="mt-1 whitespace-pre-wrap">{ev.reason}</p>}
              </div>
            </div>
            {isAdmin && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                onClick={() => remove(ev.id)}
                aria-label="Delete entry"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Log buffer exchange</DialogTitle>
              <DialogDescription>
                Record mobile-phase or buffer composition changes to correlate with
                signal, retention time, and peak-shape shifts.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <div>
                <Label htmlFor="be-kind">Exchange type</Label>
                <Select value={kind} onValueChange={(k) => setKind(k as Kind)}>
                  <SelectTrigger id="be-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buffer_a">Buffer A change</SelectItem>
                    <SelectItem value="buffer_b">Buffer B change</SelectItem>
                    <SelectItem value="both">Both buffers changed</SelectItem>
                    <SelectItem value="solvent_lot">Solvent lot change</SelectItem>
                    <SelectItem value="mobile_phase_prep">Mobile phase prep</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="be-old-desc">Old description</Label>
                  <Input
                    id="be-old-desc"
                    value={oldDesc}
                    onChange={(e) => setOldDesc(e.target.value)}
                    placeholder="e.g. 0.1% formic acid in water"
                    maxLength={200}
                  />
                </div>
                <div>
                  <Label htmlFor="be-new-desc">New description</Label>
                  <Input
                    id="be-new-desc"
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="e.g. 0.1% formic acid in water (lot B)"
                    maxLength={200}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="be-old-lot">Old lot #</Label>
                  <Input
                    id="be-old-lot"
                    value={oldLot}
                    onChange={(e) => setOldLot(e.target.value)}
                    placeholder="Lot number"
                    maxLength={100}
                  />
                </div>
                <div>
                  <Label htmlFor="be-new-lot">New lot #</Label>
                  <Input
                    id="be-new-lot"
                    value={newLot}
                    onChange={(e) => setNewLot(e.target.value)}
                    placeholder="Lot number"
                    maxLength={100}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="be-batch">Associated batch (optional)</Label>
                <Select value={batchId} onValueChange={setBatchId}>
                  <SelectTrigger id="be-batch">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {batches.map((b: Batch) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label htmlFor="be-reason">Reason / notes</Label>
                <Textarea
                  id="be-reason"
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                  placeholder="Why was the buffer exchanged?"
                />
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save event"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
