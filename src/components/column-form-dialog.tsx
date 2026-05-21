import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Column } from "@/lib/lab-types";

export type ColumnFormValues = {
  id?: string;
  name: string;
  manufacturer: string;
  chemistry: string;
  dimensions: string;
  particleSize: string;
  serial: string;
  ratedInjections: number;
  usedInjections: number;
  status: "healthy" | "warn" | "expired";
  notes: string;
};

const EMPTY: ColumnFormValues = {
  name: "",
  manufacturer: "",
  chemistry: "",
  dimensions: "",
  particleSize: "",
  serial: "",
  ratedInjections: 1000,
  usedInjections: 0,
  status: "healthy",
  notes: "",
};

function fromColumn(c: Column): ColumnFormValues {
  return {
    id: c.id,
    name: c.name,
    manufacturer: c.manufacturer ?? "",
    chemistry: c.chemistry ?? "",
    dimensions: c.dimensions ?? "",
    particleSize: c.particleSize ?? "",
    serial: c.serial ?? "",
    ratedInjections: c.ratedInjections ?? 1000,
    usedInjections: c.injectionsUsed ?? 0,
    status: (c.status as ColumnFormValues["status"]) ?? "healthy",
    notes: c.notes ?? "",
  };
}

export function ColumnFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
  title,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Column;
  onSubmit: (values: ColumnFormValues) => Promise<void>;
  title?: string;
}) {
  const [v, setV] = useState<ColumnFormValues>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setV(initial ? fromColumn(initial) : EMPTY);
  }, [open, initial]);

  const missing =
    v.name.trim().length === 0
      ? "Name required"
      : v.ratedInjections <= 0
        ? "Rated injections must be > 0"
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missing) return;
    setBusy(true);
    try {
      await onSubmit(v);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-2xl">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title ?? (initial ? "Edit column" : "Add column")}</DialogTitle>
            <DialogDescription>
              Track a chromatography column's chemistry, dimensions and lifetime.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="col-name">Name *</Label>
              <Input
                id="col-name"
                value={v.name}
                onChange={(e) => setV({ ...v, name: e.target.value })}
                placeholder="ACQUITY BEH C18 — bench 2"
                autoFocus
                required
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="col-mfr">Manufacturer</Label>
              <Input
                id="col-mfr"
                value={v.manufacturer}
                onChange={(e) => setV({ ...v, manufacturer: e.target.value })}
                placeholder="Waters"
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="col-chem">Chemistry</Label>
              <Input
                id="col-chem"
                value={v.chemistry}
                onChange={(e) => setV({ ...v, chemistry: e.target.value })}
                placeholder="C18"
                maxLength={200}
              />
            </div>
            <div>
              <Label htmlFor="col-dim">Dimensions</Label>
              <Input
                id="col-dim"
                value={v.dimensions}
                onChange={(e) => setV({ ...v, dimensions: e.target.value })}
                placeholder="2.1 × 100 mm"
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="col-part">Particle size</Label>
              <Input
                id="col-part"
                value={v.particleSize}
                onChange={(e) => setV({ ...v, particleSize: e.target.value })}
                placeholder="1.7 µm"
                maxLength={50}
              />
            </div>
            <div>
              <Label htmlFor="col-serial">Serial #</Label>
              <Input
                id="col-serial"
                value={v.serial}
                onChange={(e) => setV({ ...v, serial: e.target.value })}
                placeholder="0224-XX"
                maxLength={100}
              />
            </div>
            <div>
              <Label htmlFor="col-status">Status</Label>
              <Select
                value={v.status}
                onValueChange={(s) => setV({ ...v, status: s as ColumnFormValues["status"] })}
              >
                <SelectTrigger id="col-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="healthy">Healthy</SelectItem>
                  <SelectItem value="warn">Warning</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="col-rated">Rated injections</Label>
              <Input
                id="col-rated"
                type="number"
                min={1}
                max={100000}
                value={v.ratedInjections}
                onChange={(e) =>
                  setV({ ...v, ratedInjections: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div>
              <Label htmlFor="col-used">Injections used</Label>
              <Input
                id="col-used"
                type="number"
                min={0}
                value={v.usedInjections}
                onChange={(e) =>
                  setV({ ...v, usedInjections: Number(e.target.value) || 0 })
                }
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="col-notes">Notes</Label>
              <Textarea
                id="col-notes"
                value={v.notes}
                onChange={(e) => setV({ ...v, notes: e.target.value })}
                rows={3}
                maxLength={5000}
                placeholder="Conditioning protocol, observed back-pressure, etc."
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <div className="mr-auto text-[11px] text-muted-foreground">
              {missing ?? (initial ? "Save updates" : "Add to library")}
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!!missing || busy}>
              {busy ? "Saving…" : initial ? "Save" : "Add column"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
