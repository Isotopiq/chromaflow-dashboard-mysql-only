import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RotateCcw, Shield, Wrench, Trash2 } from "lucide-react";
import { useLab } from "@/lib/store";
import type { Column, ColumnServiceEvent } from "@/lib/lab-types";
import {
  listColumnServiceEvents,
  logColumnService,
  deleteColumnServiceEvent,
} from "@/lib/lab.functions";

type Kind = ColumnServiceEvent["kind"];

const KIND_LABEL: Record<Kind, string> = {
  reset: "Injection count reset",
  guard_change: "Guard cartridge change",
  maintenance: "Maintenance",
  install: "New column installed",
};

const KIND_ICON: Record<Kind, React.ReactNode> = {
  reset: <RotateCcw className="h-3.5 w-3.5" />,
  guard_change: <Shield className="h-3.5 w-3.5" />,
  maintenance: <Wrench className="h-3.5 w-3.5" />,
  install: <Wrench className="h-3.5 w-3.5" />,
};

export function ColumnServicePanel({ column }: { column: Column }) {
  const { upsertColumnLocal } = useLab();
  const listFn = useServerFn(listColumnServiceEvents);
  const logFn = useServerFn(logColumnService);
  const delFn = useServerFn(deleteColumnServiceEvent);

  const [events, setEvents] = useState<ColumnServiceEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<Kind>("guard_change");
  const [resetUsage, setResetUsage] = useState(true);
  const [resetInstalledAt, setResetInstalledAt] = useState(false);
  const [serial, setSerial] = useState("");
  const [status, setStatus] = useState<Column["status"]>("healthy");
  const [notes, setNotes] = useState("");

  const load = async () => {
    try {
      const rows = await listFn({ data: { columnId: column.id } });
      setEvents(rows);
      setLoadError(null);
    } catch (err: any) {
      setEvents([]);
      setLoadError(err?.message ?? "Could not load service history");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.id]);

  const openFor = (k: Kind) => {
    setKind(k);
    setResetUsage(k !== "maintenance");
    setResetInstalledAt(k === "install");
    setSerial(k === "install" ? "" : column.serial ?? "");
    setStatus("healthy");
    setNotes("");
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await logFn({
        data: { columnId: column.id, kind, resetUsage, resetInstalledAt, serial, status, notes },
      });
      upsertColumnLocal(res.column);
      setEvents((prev) => [res.event, ...(prev ?? [])]);
      toast.success(
        resetUsage ? "Logged — injection count reset to 0" : `Logged ${KIND_LABEL[kind]}`,
      );
      setOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to record service event");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await delFn({ data: { id } });
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
            Service & maintenance
          </div>
          <h2 className="text-sm font-semibold">Guard changes & usage resets</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openFor("guard_change")}>
            <Shield className="mr-1 h-3.5 w-3.5" /> Guard change
          </Button>
          <Button size="sm" variant="outline" onClick={() => openFor("maintenance")}>
            <Wrench className="mr-1 h-3.5 w-3.5" /> Maintenance
          </Button>
          <Button size="sm" onClick={() => openFor("reset")}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reset injections
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
            No service events recorded yet.
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
                  {ev.resetUsage && (
                    <Badge variant="outline" className="text-[10px]">
                      {ev.injectionsBefore} → {ev.injectionsAfter}
                    </Badge>
                  )}
                  {ev.serial && (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      S/N {ev.serial}
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground">
                  {new Date(ev.createdAt).toLocaleString()}
                </div>
                {ev.notes && <p className="mt-1 whitespace-pre-wrap">{ev.notes}</p>}
              </div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              onClick={() => remove(ev.id)}
              aria-label="Delete entry"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="max-w-lg">
          <form onSubmit={submit}>
            <DialogHeader>
              <DialogTitle>Record service event</DialogTitle>
              <DialogDescription>
                Log guard cartridge changes, maintenance or a fresh column and reset the
                injection counter when needed.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4">
              <div>
                <Label htmlFor="svc-kind">Event type</Label>
                <Select value={kind} onValueChange={(k) => setKind(k as Kind)}>
                  <SelectTrigger id="svc-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="guard_change">Guard cartridge change</SelectItem>
                    <SelectItem value="reset">Injection count reset</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="install">New column installed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-start gap-2 rounded-md border border-border p-3">
                <Checkbox
                  id="svc-reset"
                  checked={resetUsage}
                  onCheckedChange={(v) => setResetUsage(v === true)}
                />
                <div className="grid gap-0.5">
                  <Label htmlFor="svc-reset" className="cursor-pointer">
                    Reset injection count to 0
                  </Label>
                  <span className="text-[11px] text-muted-foreground">
                    Currently {column.injectionsUsed} / {column.ratedInjections} used. Also
                    clears the pressure trend.
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="svc-installed"
                  checked={resetInstalledAt}
                  onCheckedChange={(v) => setResetInstalledAt(v === true)}
                />
                <Label htmlFor="svc-installed" className="cursor-pointer">
                  Set install date to today
                </Label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="svc-serial">Serial # (optional)</Label>
                  <Input
                    id="svc-serial"
                    value={serial}
                    onChange={(e) => setSerial(e.target.value)}
                    placeholder="New cartridge / column serial"
                    maxLength={100}
                  />
                </div>
                <div>
                  <Label htmlFor="svc-status">Status after service</Label>
                  <Select
                    value={status}
                    onValueChange={(s) => setStatus(s as Column["status"])}
                  >
                    <SelectTrigger id="svc-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="healthy">Healthy</SelectItem>
                      <SelectItem value="warn">Warning</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="svc-notes">Notes</Label>
                <Textarea
                  id="svc-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={5000}
                  placeholder="Guard lot #, observed back-pressure before/after, technician…"
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
