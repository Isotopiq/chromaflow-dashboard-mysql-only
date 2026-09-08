import { useEffect, useState } from "react";
import type { QueueItem } from "@shared/ipc-types";
import { Icons } from "../components/ui";

export interface UploadModalProps {
  onClose: () => void;
}

export function UploadModal({ onClose }: UploadModalProps) {
  const [active, setActive] = useState<QueueItem | null>(null);

  useEffect(() => {
    const d = window.desktop;
    if (!d) return;
    let latest: QueueItem | null = null;
    const off = d.onUploadProgress((item) => {
      if (item.status === "uploading") {
        latest = item;
        setActive(item);
      }
    });
    d.getQueue()
      .then((items) => {
        const uploading = items.find((i) => i.status === "uploading");
        if (uploading && !latest) setActive(uploading);
      })
      .catch(() => {});
    return () => off?.();
  }, []);

  const progress = active?.progress ?? 0;
  const filename = active?.filename ?? "No active upload";
  const transferred = active ? formatBytes((active.size * progress) / 100) : "—";
  const total = active ? formatBytes(active.size) : "—";

  const onCancel = () => {
    if (active && window.desktop) void window.desktop.cancelUpload(active.id);
    onClose();
  };

  return (
    <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-30">
      <div className="w-[480px] bg-white border border-[#D1D5DB] shadow-2xl flex flex-col" style={{ borderRadius: 0 }}>
        {/* Mini title bar */}
        <div className="flex items-center justify-between px-3 h-8 bg-[#F3F4F6] border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="#EBF1FE" stroke="#BFCFFB"/><path d="M8 5v3.5L10.5 10" stroke="#2563EB" strokeWidth="1.5" strokeLinecap="round"/></svg>
            <span className="text-[11px] font-semibold text-[#374151]">Uploading File</span>
          </div>
          <button onClick={onClose} className="w-7 h-full flex items-center justify-center text-[#6B7280] hover:bg-[#DC2626] hover:text-white transition-colors">{Icons.winClose}</button>
        </div>
        {/* Content */}
        <div className="p-5">
          <p className="text-[11px] font-semibold text-[#2563EB] font-mono mb-4">{filename}</p>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-[#6B7280]">Progress</span>
            <span className="text-[11px] font-semibold text-[#2563EB]">{progress}%</span>
          </div>
          <div className="h-3 w-full bg-[#EBF1FE] border border-[#BFCFFB] overflow-hidden mb-4" style={{ borderRadius: 2 }}>
            <div className="h-full bg-[#2563EB] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="flex items-center gap-5 mb-5 bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-2" style={{ borderRadius: 2 }}>
            <div className="text-center"><p className="text-[10px] text-[#9CA3AF]">Transferred</p><p className="text-[11px] font-mono font-semibold text-[#374151]">{transferred} / {total}</p></div>
            <div className="w-px h-6 bg-[#E5E7EB]" />
            <div className="text-center"><p className="text-[10px] text-[#9CA3AF]">Retries</p><p className="text-[11px] font-mono font-semibold text-[#374151]">{active?.retries ?? 0}</p></div>
            <div className="w-px h-6 bg-[#E5E7EB]" />
            <div className="text-center"><p className="text-[10px] text-[#9CA3AF]">Status</p><p className="text-[11px] font-mono font-semibold text-[#374151]">{active?.status ?? "idle"}</p></div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} className="px-4 py-1.5 text-[11px] font-medium text-[#374151] border border-[#D1D5DB] bg-white hover:bg-[#F3F4F6] transition-colors" style={{ borderRadius: 2 }}>Minimize to Queue</button>
            <button onClick={onCancel} className="px-4 py-1.5 text-[11px] font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] transition-colors" style={{ borderRadius: 2 }}>Cancel Upload</button>
          </div>
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
