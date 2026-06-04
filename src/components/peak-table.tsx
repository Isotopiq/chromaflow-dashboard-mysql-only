import { useEffect, useMemo, useState } from "react";
import type { Peak } from "@/lib/lab-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export function PeakTable({
  peaks,
  selectedId,
  onSelect,
  onUnassign,
}: {
  peaks: Peak[];
  selectedId?: string;
  onSelect?: (p: Peak) => void;
  /** When provided, renders checkboxes and per-row/bulk delete-assignment actions. */
  onUnassign?: (peakIds: string[]) => void | Promise<void>;
}) {
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);

  const totalPages = Math.max(1, Math.ceil(peaks.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedPeaks = useMemo(
    () => peaks.slice((page - 1) * pageSize, page * pageSize),
    [peaks, page, pageSize],
  );

  const assignedIds = useMemo(
    () => peaks.filter((p) => p.analyteName).map((p) => p.id),
    [peaks],
  );
  const allAssignedChecked =
    assignedIds.length > 0 && assignedIds.every((id) => checked.has(id));

  const toggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allAssignedChecked) setChecked(new Set());
    else setChecked(new Set(assignedIds));
  };

  const handleBulk = async () => {
    if (!onUnassign || checked.size === 0) return;
    await onUnassign(Array.from(checked));
    setChecked(new Set());
  };

  const handleRow = async (id: string) => {
    if (!onUnassign) return;
    await onUnassign([id]);
    setChecked((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div className="space-y-2">
      {onUnassign && (
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="text-[10px] text-muted-foreground">
            {checked.size > 0
              ? `${checked.size} selected`
              : `${assignedIds.length} assigned`}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={checked.size === 0}
            onClick={handleBulk}
            className="h-7 text-[11px]"
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Clear assignment{checked.size === 1 ? "" : "s"}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {onUnassign && (
                <TableHead className="h-8 w-8">
                  <Checkbox
                    checked={allAssignedChecked}
                    disabled={assignedIds.length === 0}
                    onCheckedChange={toggleAll}
                    aria-label="Select all assigned peaks"
                  />
                </TableHead>
              )}
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">RT</TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">Area</TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">Height</TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">FWHM</TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">S/N</TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">m/z</TableHead>
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">Annotation</TableHead>
              {onUnassign && <TableHead className="h-8 w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedPeaks.map((p) => {
              const isAssigned = !!p.analyteName;
              return (
                <TableRow
                  key={p.id}
                  onClick={() => onSelect?.(p)}
                  className={cn(
                    "cursor-pointer font-mono text-xs",
                    selectedId === p.id && "bg-accent/40",
                  )}
                >
                  {onUnassign && (
                    <TableCell
                      className="py-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={checked.has(p.id)}
                        disabled={!isAssigned}
                        onCheckedChange={() => toggle(p.id)}
                        aria-label="Select peak"
                      />
                    </TableCell>
                  )}
                  <TableCell className="py-1.5">{p.rt.toFixed(2)}</TableCell>
                  <TableCell className="py-1.5">{p.area.toLocaleString()}</TableCell>
                  <TableCell className="py-1.5">{p.height.toLocaleString()}</TableCell>
                  <TableCell className="py-1.5">{p.fwhm.toFixed(3)}</TableCell>
                  <TableCell className="py-1.5">{p.sn.toFixed(1)}</TableCell>
                  <TableCell className="py-1.5">{p.mz?.toFixed(4) ?? "—"}</TableCell>
                  <TableCell className="py-1.5 font-sans">
                    {p.analyteName ? (
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className="border-[color:var(--peak-annotated)] text-[10px] text-[color:var(--peak-annotated)]"
                        >
                          {p.analyteName}
                        </Badge>
                        {p.confidence !== undefined && (
                          <span className="text-[10px] text-muted-foreground">
                            {(p.confidence * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">unannotated</span>
                    )}
                  </TableCell>
                  {onUnassign && (
                    <TableCell
                      className="py-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isAssigned && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRow(p.id)}
                          aria-label="Clear assignment"
                          title="Clear assignment"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
