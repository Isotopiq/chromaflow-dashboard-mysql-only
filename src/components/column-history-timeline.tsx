import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Pencil, Wrench, Droplets, FlaskConical, HeartPulse,
  ChevronDown, ChevronRight, History,
} from "lucide-react";
import type { Column, ColumnHistoryEntry } from "@/lib/lab-types";
import { getColumnHistory } from "@/lib/v3-functions";

const SOURCE_CONFIG: Record<
  ColumnHistoryEntry["source"],
  { icon: React.ReactNode; color: string; label: string }
> = {
  audit: { icon: <Pencil className="h-3.5 w-3.5" />, color: "text-blue-600 dark:text-blue-400", label: "Column edit" },
  service_event: { icon: <Wrench className="h-3.5 w-3.5" />, color: "text-green-600 dark:text-green-400", label: "Service" },
  buffer_exchange: { icon: <Droplets className="h-3.5 w-3.5" />, color: "text-orange-600 dark:text-orange-400", label: "Buffer" },
  injection: { icon: <FlaskConical className="h-3.5 w-3.5" />, color: "text-gray-600 dark:text-gray-400", label: "Injection" },
  qc_run: { icon: <HeartPulse className="h-3.5 w-3.5" />, color: "text-purple-600 dark:text-purple-400", label: "QC run" },
};

const ACTION_COLORS: Record<string, string> = {
  insert: "bg-green-500/15 text-green-700 dark:text-green-400",
  update: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  delete: "bg-red-500/15 text-red-700 dark:text-red-400",
  create: "bg-green-500/15 text-green-700 dark:text-green-400",
  log: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

export function ColumnHistoryTimeline({ column }: { column: Column }) {
  const getHistoryFn = useServerFn(getColumnHistory);
  const [entries, setEntries] = useState<ColumnHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<string>("__none__");

  const load = async () => {
    try {
      const rows = await getHistoryFn({ data: { columnId: column.id } });
      setEntries(rows);
      setError(null);
    } catch (err: any) {
      setEntries([]);
      setError(err?.message ?? "Could not load column history");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.id]);

  const filteredEntries = (entries ?? []).filter((e) => {
    if (sourceFilter !== "__none__" && e.source !== sourceFilter) return false;
    return true;
  });

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Full history
          </div>
          <h2 className="flex items-center gap-1.5 text-sm font-semibold">
            <History className="h-3.5 w-3.5" /> Column audit trail & timeline
          </h2>
        </div>
        <div className="w-48">
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">All sources</SelectItem>
              <SelectItem value="audit">Column edits</SelectItem>
              <SelectItem value="service_event">Service events</SelectItem>
              <SelectItem value="buffer_exchange">Buffer exchanges</SelectItem>
              <SelectItem value="injection">Injections</SelectItem>
              <SelectItem value="qc_run">QC runs</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
          {error}
        </div>
      )}
      {!error && entries == null && (
        <div className="mt-3 text-xs text-muted-foreground">Loading history…</div>
      )}
      {!error && filteredEntries.length === 0 && entries != null && (
        <div className="mt-3 text-xs text-muted-foreground">No history entries found.</div>
      )}

      {filteredEntries.length > 0 && (
        <div className="mt-3 max-h-[500px] overflow-y-auto pr-1">
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border" />

            <div className="space-y-2">
              {filteredEntries.map((entry) => {
                const config = SOURCE_CONFIG[entry.source];
                const isExpanded = expanded.has(entry.id);
                const hasDiff = entry.diff != null && Object.keys(entry.diff).length > 0;
                return (
                  <div key={entry.id} className="relative pl-8">
                    {/* Dot */}
                    <div className={`absolute left-[10px] top-1.5 flex h-3 w-3 items-center justify-center rounded-full border-2 border-background ${config.color} bg-current opacity-80`} />

                    <div className="rounded-md px-2 py-1.5 text-xs hover:bg-accent/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-1.5">
                          <span className={`mt-0.5 shrink-0 ${config.color}`}>{config.icon}</span>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                variant="outline"
                                className={`text-[9px] ${ACTION_COLORS[entry.action] ?? "bg-gray-500/15"}`}
                              >
                                {entry.action}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">{config.label}</span>
                            </div>
                            <p className="mt-0.5 break-words">{entry.summary}</p>
                            <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                              <span>{new Date(entry.createdAt).toLocaleString()}</span>
                              {entry.actorName && <span>· {entry.actorName}</span>}
                            </div>
                            {hasDiff && (
                              <button
                                onClick={() => toggle(entry.id)}
                                className="mt-1 flex items-center gap-0.5 text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                              >
                                {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                                {isExpanded ? "Hide details" : "Show details"}
                              </button>
                            )}
                            {isExpanded && hasDiff && (
                              <pre className="mt-1 overflow-x-auto rounded-md bg-muted/50 p-2 text-[10px] font-mono">
                                {JSON.stringify(entry.diff, null, 2)}
                              </pre>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
