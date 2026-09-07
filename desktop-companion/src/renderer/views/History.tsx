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

  useEffect(() => {
    const d = window.desktop;
    if (!d) { setEntries([]); setTotal(0); return; }
    let active = true;
    d.getHistory(page, PAGE_SIZE)
      .then((res) => { if (active) { setEntries(res.entries); setTotal(res.total); } })
      .catch(() => { if (active) { setEntries([]); setTotal(0); } });
    return () => { active = false; };
  }, [page]);

  const copy = (h: string) => {
    navigator.clipboard.writeText(h);
    setCopied(h);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const exportCsv = async () => {
    const d = window.desktop;
    if (!d) return;
    try { await d.exportHistoryCsv(); } catch { /* noop */ }
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
          <thead>
            <tr className="bg-[#F3F4F6] sticky top-0 z-10">
              {["Filename", "Source Directory", "Uploaded At", "Size", "Duration", "Status", "SHA-256"].map((h) => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] px-3 py-2 whitespace-nowrap border-b border-[#E5E7EB]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-[11px] text-[#9CA3AF] py-10">No history entries</td>
              </tr>
            )}
            {filtered.map((row, i) => (
              <tr
                key={row.id}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                className={cn("border-b border-[#F3F4F6] transition-colors", hovered === i ? "bg-[#EBF1FE]" : i % 2 === 0 ? "bg-white" : "bg-[#F9FAFB]")}
              >
                <td className="px-3 py-2"><span className="text-[11px] text-[#111827] font-mono">{row.filename}</span></td>
                <td className="px-3 py-2 max-w-[130px]"><span className="text-[11px] text-[#6B7280] truncate block">{row.sourceDir}</span></td>
                <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280] whitespace-nowrap">{timeAgo(row.uploadedAt)}</span></td>
                <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280]">{formatBytes(row.size)}</span></td>
                <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280]">{(row.durationMs / 1000).toFixed(1)}s</span></td>
                <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5 group">
                    <span className="text-[11px] font-mono text-[#6B7280]">{row.sha256.slice(0, 8)}…</span>
                    <button onClick={() => copy(row.sha256)} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#9CA3AF] hover:text-[#2563EB]">
                      {copied === row.sha256 ? <span className="text-[9px] text-[#16A34A] font-bold">✓</span> : Icons.copy}
                    </button>
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
          {totalPages > 1 && <PageBtn label={String(Math.min(2, totalPages))} active={false} onClick={() => setPage(2)} />}
          {totalPages > 3 && <span className="px-1 text-[11px] text-[#9CA3AF]">…</span>}
          {totalPages > 2 && <PageBtn label={String(totalPages)} active={false} onClick={() => setPage(totalPages)} />}
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
