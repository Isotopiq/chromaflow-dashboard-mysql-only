import { useState } from "react";
import type { QueueItem } from "@shared/ipc-types";
import { cn, Icons, StatusBadge, ProgressBar } from "../components/ui";
import { useQueue, useWatcherStatus } from "../hooks/useDesktop";

export function Queue() {
  const { items, cancel, retry, remove, clearQueue } = useQueue();
  const watcherStatus = useWatcherStatus();
  const paused = watcherStatus === "paused";
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const toggle = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const toggleAll = () => {
    const filteredIds = filtered.map((i) => i.id);
    const allSelected = filteredIds.every((id) => selected.includes(id));
    setSelected(allSelected ? [] : filteredIds);
  };

  const filtered = query
    ? items.filter((i) => i.filename.toLowerCase().includes(query.toLowerCase()))
    : items;

  const pending = items.filter((i) => i.status === "queued" || i.status === "uploading").length;
  const failed = items.filter((i) => i.status === "failed" || i.status === "cancelled").length;
  const done = items.filter((i) => i.status === "done").length;

  const togglePause = () => {
    if (paused) window.desktop?.resumeAll();
    else window.desktop?.pauseAll();
  };

  const removeSelected = async () => {
    for (const id of selected) {
      await remove(id);
    }
    setSelected([]);
  };

  return (
    <div className="flex flex-col h-full bg-[#F9FAFB]">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#E5E7EB] bg-white shrink-0">
        <span className="text-[11px] text-[#6B7280] mr-1">{items.length} items</span>
        <div className="w-px h-4 bg-[#E5E7EB]" />
        <button
          onClick={togglePause}
          className="px-2.5 py-1 text-[11px] text-[#374151] border border-[#D1D5DB] bg-white hover:bg-[#F9FAFB] transition-colors"
          style={{ borderRadius: 2 }}
        >
          {paused ? "▶ Resume All" : "⏸ Pause All"}
        </button>
        <button
          onClick={() => { items.filter((i) => i.status === "uploading" || i.status === "queued").forEach((i) => void cancel(i.id)); }}
          className="px-2.5 py-1 text-[11px] text-[#DC2626] border border-[#FECACA] bg-[#FEF2F2] hover:bg-[#FEE2E2] transition-colors"
          style={{ borderRadius: 2 }}
        >
          ✕ Cancel All
        </button>
        <div className="flex-1" />
        {selected.length > 0 && (
          <button
            onClick={() => void removeSelected()}
            className="px-2.5 py-1 text-[11px] text-[#DC2626] border border-[#FECACA] bg-[#FEF2F2] hover:bg-[#FEE2E2] transition-colors"
            style={{ borderRadius: 2 }}
          >
            Remove {selected.length} selected
          </button>
        )}
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[#9CA3AF]">{Icons.search}</span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="pl-6 pr-2.5 py-1 w-40 text-[11px] bg-white border border-[#D1D5DB] text-[#111827] placeholder-[#9CA3AF] outline-none focus:border-[#2563EB]"
            style={{ borderRadius: 2 }}
          />
        </div>
      </div>

      {/* Bulk action bar */}
      {(failed > 0 || done > 0) && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#F3F4F6] bg-[#FAFAFA] shrink-0">
          <span className="text-[10px] text-[#9CA3AF] mr-1">Bulk actions:</span>
          {done > 0 && (
            <button
              onClick={() => void clearQueue("completed")}
              className="px-2 py-0.5 text-[10px] text-[#16A34A] border border-[#BBF7D0] bg-[#ECFDF3] hover:bg-[#D1FAE5] transition-colors"
              style={{ borderRadius: 2 }}
            >
              Clear {done} completed
            </button>
          )}
          {failed > 0 && (
            <button
              onClick={() => void clearQueue("failed")}
              className="px-2 py-0.5 text-[10px] text-[#DC2626] border border-[#FECACA] bg-[#FEF2F2] hover:bg-[#FEE2E2] transition-colors"
              style={{ borderRadius: 2 }}
            >
              Clear {failed} failed
            </button>
          )}
          <button
            onClick={() => void clearQueue("all")}
            className="px-2 py-0.5 text-[10px] text-[#6B7280] border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] transition-colors"
            style={{ borderRadius: 2 }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="bg-[#F3F4F6] sticky top-0 z-10">
              <th className="px-3 py-2 w-8">
                <input
                  type="checkbox"
                  checked={filtered.length > 0 && filtered.every((i) => selected.includes(i.id))}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 accent-[#2563EB] cursor-pointer"
                />
              </th>
              {["Filename", "Directory", "Size", "Detected", "Status", "Progress", "Actions"].map((h) => (
                <th key={h} className="text-left text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] px-3 py-2 whitespace-nowrap border-b border-[#E5E7EB]">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-[11px] text-[#9CA3AF] py-10">No items in the queue</td>
              </tr>
            )}
            {filtered.map((row, i) => (
              <QueueRow
                key={row.id}
                row={row}
                alt={i % 2 === 0}
                hovered={hovered === row.id}
                selected={selected.includes(row.id)}
                onHover={(v) => setHovered(v ? row.id : null)}
                onToggle={() => toggle(row.id)}
                onCancel={() => void cancel(row.id)}
                onRetry={() => void retry(row.id)}
                onRemove={() => void remove(row.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QueueRow({
  row,
  alt,
  hovered,
  selected,
  onHover,
  onToggle,
  onCancel,
  onRetry,
  onRemove,
}: {
  row: QueueItem;
  alt: boolean;
  hovered: boolean;
  selected: boolean;
  onHover: (v: boolean) => void;
  onToggle: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const dir = extractDir(row.filePath);
  const sizeStr = formatBytes(row.size);
  const detected = timeAgo(row.createdAt);

  return (
    <tr
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn("border-b border-[#F3F4F6] transition-colors", hovered ? "bg-[#EBF1FE]" : alt ? "bg-white" : "bg-[#F9FAFB]")}
    >
      <td className="px-3 py-2 w-8">
        <input type="checkbox" checked={selected} onChange={onToggle} className="w-3.5 h-3.5 accent-[#2563EB] cursor-pointer" />
      </td>
      <td className="px-3 py-2"><span className="text-[11px] text-[#111827] font-medium font-mono">{row.filename}</span></td>
      <td className="px-3 py-2 max-w-[150px]"><span className="text-[11px] text-[#6B7280] truncate block">{dir}</span></td>
      <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280] whitespace-nowrap">{sizeStr}</span></td>
      <td className="px-3 py-2"><span className="text-[11px] text-[#6B7280] whitespace-nowrap">{detected}</span></td>
      <td className="px-3 py-2"><StatusBadge status={row.status} /></td>
      <td className="px-3 py-2 w-28">
        <ProgressBar value={row.progress} status={row.status} />
        <span className="text-[9px] text-[#9CA3AF] mt-0.5 block">{row.progress > 0 ? `${row.progress}%` : "—"}</span>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-0.5">
          {row.status === "failed" && (
            <button onClick={onRetry} className="p-1 text-[#2563EB] hover:bg-[#EBF1FE] rounded-sm transition-colors" title="Retry upload">{Icons.retry}</button>
          )}
          {row.status === "done" && (
            <span className="p-1 text-[#16A34A]" title="Upload complete">{Icons.check}</span>
          )}
          {(row.status === "queued" || row.status === "uploading" || row.status === "parsing") && (
            <button onClick={onCancel} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-sm transition-colors" title="Cancel upload">{Icons.cancel}</button>
          )}
          <button onClick={onRemove} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-sm transition-colors" title="Remove from queue">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M6 4V2h4v2M3 4l1 10h8l1-10" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

function extractDir(filePath: string): string {
  const idx = filePath.replace(/\\/g, "/").lastIndexOf("/");
  return idx >= 0 ? filePath.slice(0, idx) : filePath;
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
  return `${h} hr ago`;
}
