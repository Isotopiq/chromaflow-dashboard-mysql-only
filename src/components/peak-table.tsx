import { useEffect, useMemo, useRef, useState } from "react";
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
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SortKey = "rt" | "area" | "height" | "fwhm" | "sn" | "r2" | "mz";
type SortDir = "asc" | "desc";

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
  const [sortKey, setSortKey] = useState<SortKey>("rt");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [annotatedOnly, setAnnotatedOnly] = useState(false);

  const hasR2 = useMemo(() => peaks.some((p) => p.r2 != null), [peaks]);

  const filtered = useMemo(
    () => (annotatedOnly ? peaks.filter((p) => !!p.analyteName) : peaks),
    [peaks, annotatedOnly],
  );

  const sorted = useMemo(() => {
    const arr = filtered.slice();
    const sign = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      const av = (a[sortKey] as number | undefined) ?? 0;
      const bv = (b[sortKey] as number | undefined) ?? 0;
      return (av - bv) * sign;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // When selection changes, page to the selected row so it's actually visible.
  useEffect(() => {
    if (!selectedId) return;
    const idx = sorted.findIndex((p) => p.id === selectedId);
    if (idx < 0) return;
    const targetPage = Math.floor(idx / pageSize) + 1;
    if (targetPage !== page) setPage(targetPage);
  }, [selectedId, sorted, pageSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const pagedPeaks = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const selectedRowRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId, page]);

  const assignedIds = useMemo(
    () => sorted.filter((p) => p.analyteName).map((p) => p.id),
    [sorted],
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

  const sortBy = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rt" ? "asc" : "desc");
    }
    setPage(1);
  };

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <TableHead className="h-8 text-[10px] uppercase tracking-wider">
      <button
        onClick={() => sortBy(k)}
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        {label}
        {sortKey === k && (
          sortDir === "asc"
            ? <ArrowUp className="h-3 w-3" />
            : <ArrowDown className="h-3 w-3" />
        )}
      </button>
    </TableHead>
  );

  const annotatedCount = useMemo(
    () => peaks.filter((p) => p.analyteName).length,
    [peaks],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span>
            {checked.size > 0
              ? `${checked.size} selected`
              : `${sorted.length} of ${peaks.length} · ${annotatedCount} annotated`}
          </span>
          <label className="flex cursor-pointer items-center gap-1.5">
            <Checkbox
              checked={annotatedOnly}
              onCheckedChange={(v) => {
                setAnnotatedOnly(!!v);
                setPage(1);
              }}
              aria-label="Show annotated only"
            />
            <span>Annotated only</span>
          </label>
        </div>
        {onUnassign && (
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
        )}
      </div>
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
              <Th k="rt" label="RT" />
              <Th k="area" label="Area" />
              <Th k="height" label="Height" />
              <Th k="fwhm" label="FWHM" />
              <Th k="sn" label="S/N" />
              {hasR2 && <Th k="r2" label="R²" />}
              <Th k="mz" label="m/z" />
              <TableHead className="h-8 text-[10px] uppercase tracking-wider">Annotation</TableHead>
              {onUnassign && <TableHead className="h-8 w-8" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedPeaks.map((p) => {
              const isAssigned = !!p.analyteName;
              const isSelected = selectedId === p.id;
              return (
                <TableRow
                  key={p.id}
                  ref={isSelected ? selectedRowRef : undefined}
                  data-peak-id={p.id}
                  onClick={() => onSelect?.(p)}
                  className={cn(
                    "cursor-pointer font-mono text-xs",
                    isSelected && "bg-accent/40",
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
                  {hasR2 && (
                    <TableCell className="py-1.5">
                      {p.r2 != null ? p.r2.toFixed(2) : "—"}
                    </TableCell>
                  )}
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
      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => {
                setPageSize(Number(v));
                setPage(1);
              }}
            >
              <SelectTrigger className="h-7 w-[72px] text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-[11px]">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>
              {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="px-1 font-mono">
              {page} / {totalPages}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
