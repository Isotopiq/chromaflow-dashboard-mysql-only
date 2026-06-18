import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useLab } from "@/lib/store";
import type { Column } from "@/lib/lab-types";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { StatusDot } from "@/components/status-dot";
import { ArrowLeft, Pencil, Trash2, Wrench } from "lucide-react";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  ResponsiveContainer,
  YAxis,
  XAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { upsertColumn, deleteColumn } from "@/lib/lab.functions";
import {
  ColumnFormDialog,
  type ColumnFormValues,
} from "@/components/column-form-dialog";

export const Route = createFileRoute("/_shell/columns/$columnId")({
  component: ColumnDetailGate,
  notFoundComponent: () => (
    <div className="p-6 text-sm text-muted-foreground">Column not found.</div>
  ),
});

function ColumnDetailGate() {
  const { columnId } = Route.useParams();
  const { columns, hydrated } = useLab();
  const col = columns.find((c) => c.id === columnId);
  if (!col) {
    if (!hydrated) {
      return <ColumnRouteState title="Loading column…" />;
    }
    return (
      <ColumnRouteState
        title="Column not found"
        description="This column is no longer in the library or you may not have access to it."
      />
    );
  }
  return <ColumnDetail col={normalizeColumn(col)} />;
}

function ColumnRouteState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-3 p-6">
      <Link
        to="/columns"
        className="inline-flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" /> All columns
      </Link>
      <Card className="border-border bg-card p-6">
        <div className="text-sm font-medium">{title}</div>
        {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      </Card>
    </div>
  );
}

function normalizeColumn(col: Column): Column {
  const ratedInjections = positiveNumber(col.ratedInjections, 1000);
  const status: Column["status"] = ["healthy", "warn", "expired"].includes(col.status)
    ? col.status
    : "healthy";

  return {
    ...col,
    name: col.name || "Untitled column",
    chemistry: col.chemistry ?? "",
    dimensions: col.dimensions ?? "",
    particleSize: col.particleSize ?? "",
    serial: col.serial ?? "",
    ratedInjections,
    injectionsUsed: Math.max(0, finiteNumber(col.injectionsUsed, 0)),
    installedAt: col.installedAt || "—",
    status,
    pressureTrend: Array.isArray(col.pressureTrend)
      ? col.pressureTrend.map((p) => finiteNumber(p, 0))
      : [],
    notes: col.notes ?? "",
    manufacturer: col.manufacturer ?? "",
  };
}

function finiteNumber(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function positiveNumber(value: unknown, fallback: number) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function ColumnDetail({ col }: { col: Column }) {
  const navigate = useNavigate();
  const { methods, runs, upsertColumnLocal, removeColumnLocal } = useLab();
  const upsertFn = useServerFn(upsertColumn);
  const deleteFn = useServerFn(deleteColumn);

  const linkedMethods = methods.filter((m) => m.columnId === col.id);
  const linkedRuns = runs.filter((r) => r.columnId === col.id);
  const pct = Math.min(100, (col.injectionsUsed / col.ratedInjections) * 100);
  const trend = col.pressureTrend.map((p, i) => ({ batch: `B${i + 1}`, p }));

  const [editOpen, setEditOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const [maintStatus, setMaintStatus] = useState<typeof col.status>(col.status);
  const [maintNote, setMaintNote] = useState("");

  const referenceCount = linkedMethods.length + linkedRuns.length;

  const handleEdit = async (values: ColumnFormValues) => {
    try {
      const saved = await upsertFn({ data: values as any });
      upsertColumnLocal(saved);
      toast.success("Column updated");
      setEditOpen(false);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update column");
    }
  };

  const handleMaintenance = async () => {
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const summary = [
        bump > 0 ? `+${bump} inj` : null,
        maintStatus !== col.status ? `status → ${maintStatus}` : null,
        maintNote.trim() || null,
      ]
        .filter(Boolean)
        .join(", ");
      if (!summary) {
        setMaintOpen(false);
        return;
      }
      const notes = col.notes
        ? `${col.notes.trimEnd()}\n${dateStr} · ${summary}`
        : `${dateStr} · ${summary}`;
      const saved = await upsertFn({
        data: {
          id: col.id,
          name: col.name,
          chemistry: col.chemistry,
          dimensions: col.dimensions,
          particleSize: col.particleSize,
          serial: col.serial,
          ratedInjections: col.ratedInjections,
          usedInjections: Math.max(0, col.injectionsUsed + bump),
          status: maintStatus,
          notes,
        } as any,
      });
      upsertColumnLocal(saved);
      toast.success("Maintenance logged");
      setMaintOpen(false);
      setBump(0);
      setMaintNote("");
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to log maintenance");
    }
  };

  const handleDelete = async () => {
    try {
      await deleteFn({ data: { id: col.id } });
      removeColumnLocal(col.id);
      toast.success("Column deleted");
      navigate({ to: "/columns" });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to delete column");
    }
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link
          to="/columns"
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> All columns
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <StatusDot status={col.status} />
          <h1 className="text-2xl font-semibold tracking-tight">{col.name}</h1>
          <Badge variant="outline" className="ml-1 text-[10px] capitalize">
            {col.status}
          </Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={referenceCount > 0}
                  title={
                    referenceCount > 0
                      ? `Unlink ${referenceCount} method(s)/run(s) first`
                      : undefined
                  }
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this column?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently removes "{col.name}" from your library. This action cannot
                    be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
        <div className="mt-1 font-mono text-xs text-muted-foreground">
          {col.manufacturer} · {col.chemistry} · {col.dimensions} · {col.particleSize} · S/N{" "}
          {col.serial}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Lifetime
          </div>
          <div className="mt-2 font-mono text-3xl">
            {col.injectionsUsed}
            <span className="text-base text-muted-foreground"> / {col.ratedInjections}</span>
          </div>
          <Progress value={pct} className="mt-3 h-1.5" />
          <div className="mt-1 text-[11px] text-muted-foreground">
            {pct.toFixed(0)}% of rated injections used
          </div>
          <div className="mt-4 text-[10px] uppercase tracking-widest text-muted-foreground">
            Installed
          </div>
          <div className="mt-1 font-mono text-xs">{col.installedAt}</div>
        </Card>

        <Card className="border-border bg-card p-4 lg:col-span-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Pressure trend (bar)
          </div>
          <div className="mt-3 h-48">
            {trend.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                No pressure samples yet.
              </div>
            ) : (
              <ResponsiveContainer>
                <LineChart data={trend}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                  <XAxis
                    dataKey="batch"
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                  />
                  <YAxis
                    stroke="var(--muted-foreground)"
                    tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                  />
                  <Line
                    dataKey="p"
                    type="monotone"
                    stroke="var(--chart-1)"
                    strokeWidth={1.6}
                    dot={{ r: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Notes</div>
        <p className="mt-2 whitespace-pre-wrap text-sm">
          {col.notes || <span className="text-muted-foreground">No notes recorded.</span>}
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Linked methods ({linkedMethods.length})
          </div>
          <div className="mt-2 space-y-1">
            {linkedMethods.map((m) => (
              <Link
                key={m.id}
                to="/methods/$methodId"
                params={{ methodId: m.id }}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent/40"
              >
                <span>{m.name}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{m.modality}</span>
              </Link>
            ))}
            {linkedMethods.length === 0 && (
              <div className="text-xs text-muted-foreground">No methods linked.</div>
            )}
          </div>
        </Card>
        <Card className="border-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Recent runs on this column ({linkedRuns.length})
          </div>
          <div className="mt-2 space-y-1">
            {linkedRuns.slice(0, 6).map((r) => (
              <Link
                key={r.id}
                to="/runs/$runId"
                params={{ runId: r.id }}
                className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-accent/40"
              >
                <span className="truncate font-mono">{r.name}</span>
                <span className="text-[10px] text-muted-foreground">{r.peaks.length} peaks</span>
              </Link>
            ))}
            {linkedRuns.length === 0 && (
              <div className="text-xs text-muted-foreground">No runs on this column yet.</div>
            )}
          </div>
        </Card>
      </div>

      <div className="flex justify-end">
        <Popover open={maintOpen} onOpenChange={setMaintOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setMaintStatus(col.status);
                setBump(0);
                setMaintNote("");
              }}
            >
              <Wrench className="mr-1 h-3.5 w-3.5" /> Log maintenance event
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3">
            <div>
              <Label htmlFor="bump">Add injections</Label>
              <Input
                id="bump"
                type="number"
                min={0}
                value={bump}
                onChange={(e) => setBump(Number(e.target.value) || 0)}
              />
            </div>
            <div>
              <Label htmlFor="mstatus">Status</Label>
              <Select
                value={maintStatus}
                onValueChange={(s) => setMaintStatus(s as typeof col.status)}
              >
                <SelectTrigger id="mstatus">
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
              <Label htmlFor="mnote">Note</Label>
              <Input
                id="mnote"
                value={maintNote}
                onChange={(e) => setMaintNote(e.target.value)}
                placeholder="cleaned with 50% MeOH"
                maxLength={200}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setMaintOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleMaintenance}>
                Log event
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <ColumnFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initial={col}
        onSubmit={handleEdit}
      />
    </div>
  );
}
