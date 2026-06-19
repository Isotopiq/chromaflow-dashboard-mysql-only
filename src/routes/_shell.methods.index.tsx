import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Plus } from "lucide-react";
import { useState, useMemo } from "react";

export const Route = createFileRoute("/_shell/methods/")({
  component: MethodsList,
});

function MethodsList() {
  const { methods, columns, runs } = useLab();
  const [q, setQ] = useState("");
  const [modality, setModality] = useState<string>("all");

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => {
              const col = columns.find((c) => c.id === m.columnId);
              const runCount = runs.filter((r) => r.methodId === m.id).length;
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
