import { useEffect, useState } from "react";
import type { QueueItem } from "@shared/ipc-types";
import { Icons, StatusBadge } from "../components/ui";

export interface UploadModalProps {
  onClose: () => void;
}

export function UploadModal({ onClose }: UploadModalProps) {
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    const d = window.desktop;
    if (!d) return;
    const refresh = () => {
      d.getQueue()
        .then((rows) => {
          const active = rows.filter((i) => i.status === "parsing" || i.status === "uploading");
          setItems(active);
        })
        .catch(() => {});
    };
    refresh();
    const off = d.onQueueUpdate(refresh);
    return () => off?.();
  }, []);

  const onCancel = (id: string) => {
    if (window.desktop) void window.desktop.cancelUpload(id);
  };

  return (
    <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-30">
      <div className="w-[560px] bg-white border border-[#D1D5DB] shadow-2xl flex flex-col" style={{ borderRadius: 0 }}>
        {/* Mini title bar */}
        <div className="flex items-center justify-between px-3 h-8 bg-[#F3F4F6] border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#EBF1FE" stroke="#BFCFFB"/><path d="M8 5v3.5L10.5 10" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <span className="text-[11px] font-semibold text-[#374151]">Active Uploads</span>
          </div>
          <button onClick={onClose} className="w-7 h-full flex items-center justify-center text-[#6B7280] hover:bg-[#DC2626] hover:text-white transition-colors">{Icons.winClose}</button>
        </div>
        {/* Content */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {items.length === 0 && (
            <div className="text-center text-[11px] text-[#9CA3AF] py-8">No active uploads</div>
          )}
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={item.id} className="border border-[#E5E7EB] p-3" style={{ borderRadius: 2 }}>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-[#2563EB] font-mono truncate">{item.filename}</p>
                  <StatusBadge status={item.status} />
                </div>
                <div className="h-2 w-full bg-[#EBF1FE] border border-[#BFCFFB] overflow-hidden mb-2" style={{ borderRadius: 2 }}>
                  {item.status === "parsing" ? (
                    <div className="h-full w-1/3 bg-[#2563EB] rounded-sm animate-pulse" />
                  ) : (
                    <div className="h-full bg-[#2563EB] transition-all" style={{ width: `${item.progress}%` }} />
                  )}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#6B7280]">
                  <span>{item.status === "parsing" ? "Parsing…" : `${item.progress}%`}</span>
                  <span>{formatBytes(item.size)}</span>
                </div>
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => onCancel(item.id)}
                    className="px-3 py-1 text-[10px] font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] transition-colors"
                    style={{ borderRadius: 2 }}
                  >
                    Cancel Upload
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#E5E7EB] bg-[#F9FAFB]">
          <button onClick={onClose} className="px-4 py-1.5 text-[11px] font-medium text-[#374151] border border-[#D1D5DB] bg-white hover:bg-[#F3F4F6] transition-colors" style={{ borderRadius: 2 }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}