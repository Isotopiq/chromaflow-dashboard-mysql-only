import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useLab } from "@/lib/store";
import {
  Search,
  Activity,
  FlaskConical,
  Columns3,
  Beaker,
  PackageOpen,
  FileText,
  ArrowRight,
  ListChecks,
  ListOrdered,
  Copy,
} from "lucide-react";

type SearchResult = {
  id: string;
  label: string;
  sublabel?: string;
  entityType: "run" | "method" | "column" | "batch" | "analyte" | "compoundList" | "queue" | "template";
  route: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ENTITY_META = {
  run: { icon: Activity, label: "Run" },
  method: { icon: FlaskConical, label: "Method" },
  column: { icon: Columns3, label: "Column" },
  batch: { icon: PackageOpen, label: "Batch" },
  analyte: { icon: Beaker, label: "Analyte" },
  compoundList: { icon: ListChecks, label: "Compound list" },
  queue: { icon: ListOrdered, label: "Sample queue" },
  template: { icon: Copy, label: "Template" },
} as const;

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { runs, methods, columns, batches, analytes, compoundLists, sampleQueues, methodTemplates } = useLab();
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nav = useNavigate();

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      // Focus input after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Build all searchable items
  const allItems = useMemo<SearchResult[]>(() => {
    const items: SearchResult[] = [];
    for (const r of runs) {
      items.push({
        id: `run-${r.id}`,
        label: r.name,
        sublabel: r.fileFormat,
        entityType: "run",
        route: `/runs/${r.id}`,
        icon: Activity,
      });
    }
    for (const m of methods) {
      items.push({
        id: `method-${m.id}`,
        label: m.name,
        sublabel: m.modality,
        entityType: "method",
        route: `/methods/${m.id}`,
        icon: FlaskConical,
      });
    }
    for (const c of columns) {
      items.push({
        id: `column-${c.id}`,
        label: c.name,
        sublabel: c.chemistry || c.dimensions,
        entityType: "column",
        route: `/columns/${c.id}`,
        icon: Columns3,
      });
    }
    for (const b of batches) {
      items.push({
        id: `batch-${b.id}`,
        label: b.name,
        sublabel: b.project || `${b.sampleCount} samples`,
        entityType: "batch",
        route: `/batches`,
        icon: PackageOpen,
      });
    }
    for (const a of analytes) {
      items.push({
        id: `analyte-${a.id}`,
        label: a.name,
        sublabel: a.formula || (a.mz ? `${a.mz.toFixed(4)} m/z` : undefined),
        entityType: "analyte",
        route: `/analytes`,
        icon: Beaker,
      });
    }
    for (const cl of compoundLists) {
      items.push({
        id: `clist-${cl.id}`,
        label: cl.name,
        sublabel: `${cl.analyteIds?.length ?? 0} compounds`,
        entityType: "compoundList",
        route: `/compound-lists`,
        icon: ListChecks,
      });
    }
    for (const sq of sampleQueues) {
      items.push({
        id: `queue-${sq.id}`,
        label: sq.name,
        sublabel: `${sq.entries?.length ?? 0} entries`,
        entityType: "queue",
        route: `/queues/${sq.id}`,
        icon: ListOrdered,
      });
    }
    for (const t of methodTemplates) {
      items.push({
        id: `template-${t.id}`,
        label: t.name,
        sublabel: t.description || "Method template",
        entityType: "template",
        route: `/templates`,
        icon: Copy,
      });
    }
    return items;
  }, [runs, methods, columns, batches, analytes, compoundLists, sampleQueues, methodTemplates]);

  // Filter results
  const results = useMemo(() => {
    if (!query.trim()) return allItems.slice(0, 20);
    const q = query.toLowerCase();
    return allItems
      .filter(
        (item) =>
          item.label.toLowerCase().includes(q) ||
          (item.sublabel?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 30);
  }, [allItems, query]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  const handleSelect = useCallback(
    (item: SearchResult) => {
      nav({ to: item.route });
      onClose();
    },
    [nav, onClose],
  );

  // Keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[selectedIdx]) handleSelect(results[selectedIdx]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  // Group results by entity type
  const grouped = useMemo(() => {
    const groups: Record<string, SearchResult[]> = {};
    for (const r of results) {
      if (!groups[r.entityType]) groups[r.entityType] = [];
      groups[r.entityType].push(r);
    }
    return groups;
  }, [results]);

  let flatIdx = -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search runs, methods, columns, batches, analytes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {query.trim() ? "No results found" : "Start typing to search…"}
            </div>
          ) : (
            Object.entries(grouped).map(([type, items]) => {
              const meta = ENTITY_META[type as keyof typeof ENTITY_META];
              return (
                <div key={type}>
                  <div className="bg-muted/30 px-4 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {meta.label}s
                  </div>
                  {items.map((item) => {
                    flatIdx++;
                    const idx = flatIdx;
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.id}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                          idx === selectedIdx
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/50"
                        }`}
                        onClick={() => handleSelect(item)}
                        onMouseEnter={() => setSelectedIdx(idx)}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{item.label}</div>
                          {item.sublabel && (
                            <div className="truncate text-[11px] text-muted-foreground">
                              {item.sublabel}
                            </div>
                          )}
                        </div>
                        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1 font-mono">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1 font-mono">↵</kbd>
              select
            </span>
          </div>
          <span>{results.length} result{results.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </div>
  );
}
