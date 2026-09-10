import { useEffect, useState } from "react";
import type { HistoryEntry } from "@shared/ipc-types";
import { cn, Icons, StatusBadge } from "../components/ui";

const PAGE_SIZE = 20;

export function History() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setSelected([]);
  }, [page, query]);

  useEffect(() => {
    const d = window.desktop;
    if (!d) { setEntries([]); setTotal(0); return; }
    let active = true;
    d.getHistory(page - 1, PAGE_SIZE)
      .then((res) => { if (active) { setEntries(res?.entries ?? []); setTotal(res?.total ?? 0); } })
      .catch(() => { if (active) { setEntries([]); setTotal(0); } });
    return () => { active = false; };
  }, [page, refresh]);

  const copy = (h: string | null) => {
    if (!h) return;
    navigator.clipboard.writeText(h);
    setCopied(h);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const exportCsv = async () => {
    const d = window.desktop;
    if (!d) return;
    try { await d.saveHistoryCsv(); } catch { /* noop */ }
  };

  const toggle = (id: number) => {
    setSelected((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id]);
  };

  const toggleAll = () => {
    const visibleIds = filtered.map((e) => e.id);
    const allSelected = visibleIds.every((id) => selected.includes(id));
    setSelected(allSelected ? selected.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...selected, ...visibleIds])));
  };

  const deleteIds = async (ids: number[]) => {
    const d = window.desktop;
    if (!d || ids.length === 0) return;
    setActionError(null);
    try {
      await d.deleteHistoryItems(ids);
      setSelected((p) => p.filter((id) => !ids.includes(id)));
      setRefresh((n) => n + 1);
    } catch (e: any) {
      setActionError(e?.message ?? "Failed to delete history");
    }
  };

  const deleteSelected = () => deleteIds(selected);

  const reupload = async (id: number) => {
    const d = window.desktop;
    if (!d) return;
    setActionError(null);
    try {
      const result = await d.reuploadHistoryItem(id);
      if (!result.ok) setActionError(result.error ?? "Reupload failed");
      else setRefresh((n) => n + 1);
    } catch (e: any) {
      setActionError(e?.message ?? "Reupload failed");
    }
  };

  const filtered = query
    ? entries.filter((e) => e.filename.toLowerCase().includes(query.toLowerCase()))
    : entries;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="flex flex-col h-full bg-[#F9FAFB]">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E5E7EB] bg-white shrink-0">
        <span className="text-[11px] text-[#6B7280]">Total uploads</span>
        <span className="bg-[#EBF1FE] text-[#2563EB] text-[10px] font-semibold px-1.5 py-0.5 border border-[#BFCFFB]" style={{ borderRadius: 2 }}>{total}</span>
        <div className="flex-1" />
        {actionError && (
          <span className="text-[11px] text-[#DC2626] font-medium">{actionError}</span>
        )}
        {selected.length > 0 && (
          <button onClick={() => void deleteSelected()} className="px-2.5 py-1 text-[11px] text-[#DC2626] border border-[#FECACA] bg-[#FEF2F2] hover:bg-[#FEE2E2] transition-colors" style={{ borderRadius: 2 }}>
            Delete {selected.length} selected
          </button>
        )}
        <button onClick={() => void exportCsv()} className="px-2.5 py-1 text-[11px] text-[#374151] border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] transition-colors" style={{ borderRadius: 2 }}>↓ Export CSV</button>
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]">{Icons.search}</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search history…"
            className="pl-6 pr-2.5 py-1 w-40 text-[11px] bg-white border border-[#D1D5DB] text-[#111827] placeholder-[#9CA3AF] outline-none focus:border-[#2563EB]"
            style={{ borderRadius: 2 }}
          />
        </div>
      </div>

      <div className="overflow-auto flex-1">
        <table className="w-full min-w-max border-collapse">
          <colgroup>
            <col className="w-8" />
            <col />
            <col className="w-[140px]" />
            <col className="w-28" />
            <col className="w-16" />
            <col className="w-16" />
            <col className="w-24" />
            <col className="w-24" />
            <col className="w-24" />
          </colgroup>
          <thead>
            <tr className="bg-[#F3F4F6] sticky top-0 z-10">
              <th className="px-3 py-2 text-left">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((e) => selected.includes(e.id))}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 accent-[#2563EB] cursor-pointer"
                />
              </th>
              {["Filename", "Source Directory", "Uploaded At", "Size", "Duration", "Status", "SHA-256", "Actions"].map((h) => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] px-3 py-2 whitespace-nowrap border-b border-[#E5E7EB]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center text-[11px] text-[#9CA3AF] py-10">No history entries</td>
              </tr>
            )}
            {filtered.map((row, i) => (
              <tr
                key={row.id}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className={cn("border-b border-[#F3F4F6] transition-colors", hovered === i ? "bg-[#EBF1FE]" : i % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]")}
              >
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggle(row.id)} className="w-3.5 h-3.5 accent-[#2563EB] cursor-pointer" />
                </td>
                <td className="px-3 py-2"><span className="text-[11px] text-[#111827] font-mono">{row.filename}</span></td>
                <td className="px-3 py-2 max-w-[130px]"><span className="text-[11px] text-[#6B7280] truncate block">{row.sourceDir}</span></td>
                <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280] whitespace-nowrap">{timeAgo(row.uploadedAt)}</span></td>
                <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280]">{formatBytes(row.size)}</span></td>
                <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280]">{(row.durationMs / 1000).toFixed(1)}s</span></td>
                <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5 group">
                    {row.sha256 ? (
                      <>
                        <span className="text-[11px] font-mono text-[#6B7280]">{row.sha256.slice(0, 8)}…</span>
                        <button onClick={() => copy(row.sha256)} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#9CA3AF] hover:text-[#2563EB]">
                          {copied === row.sha256 ? <span className="text-[9px] text-[#16A34A] font-bold">✓</span> : Icons.copy}
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-[#9CA3AF]">—</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <button onClick={() => void reupload(row.id)} className="p-1 text-[#2563EB] hover:bg-[#EBF1FE] rounded-sm transition-colors" title="Reupload file">{Icons.retry}</button>
                    <button onClick={() => void deleteIds([row.id])} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-sm transition-colors" title="Delete history row">{Icons.trash}</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t border-[#E5E7EB] bg-white shrink-0">
        <span className="text-[10px] text-[#9CA3AF]">
          {total === 0 ? "No uploads" : `Showing ${start}–${end} of ${total} uploads`}
        </span>
        <div className="flex items-center gap-0.5">
          <PageBtn label="‹" active={false} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
          <PageBtn label={String(page)} active onClick={() => {}} />
          {totalPages > 1 && page !== 2 && <PageBtn label={String(Math.min(2, totalPages))} active={false} onClick={() => setPage(2)} />}
          {totalPages > 3 && page < totalPages - 1 && <span className="px-1 text-[11px] text-[#9CA3AF]">…</span>}
          {totalPages > 2 && page !== totalPages && <PageBtn label={String(totalPages)} active={false} onClick={() => setPage(totalPages)} />}
          <PageBtn label="›" active={false} disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} />
        </div>
      </div>
    </div>
  );
}

function PageBtn({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "w-7 h-6 text-[11px] flex items-center justify-center transition-colors",
        active ? "bg-[#2563EB] text-white" : "text-[#374151] hover:bg-[#EBF1FE]",
        disabled && "opacity-40 pointer-events-none"
      )}
      style={{ borderRadius: 2 }}
    >
      {label}
    </button>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(ts: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}