import { useState } from "react";
import type { QueueItem } from "@shared/ipc-types";
import { useLabData, useWatchFolders } from "../hooks/useDesktop";

export interface AssignModalProps {
  item: QueueItem;
  onClose: () => void;
}

export function AssignModal({ item, onClose }: AssignModalProps) {
  const labData = useLabData();
  const { folders } = useWatchFolders();
  const folder = folders.find((f) => f.id === item.folderId);

  const [methodId, setMethodId] = useState<string>(item.assignment?.methodId ?? folder?.methodId ?? "");
  const [columnId, setColumnId] = useState<string>(item.assignment?.columnId ?? folder?.columnId ?? "");
  const [batchId, setBatchId] = useState<string>(item.assignment?.batchId ?? folder?.batchId ?? "");
  const [compoundListId, setCompoundListId] = useState<string>(item.assignment?.compoundListId ?? folder?.compoundListId ?? "");
  const [saving, setSaving] = useState(false);

  const onUseFolder = () => {
    setMethodId(folder?.methodId ?? "");
    setColumnId(folder?.columnId ?? "");
    setBatchId(folder?.batchId ?? "");
    setCompoundListId(folder?.compoundListId ?? "");
  };

  const onSave = async () => {
    if (!window.desktop) return;
    setSaving(true);
    try {
      await window.desktop.assignQueueMetadata(item.id, {
        methodId: methodId || null,
        columnId: columnId || null,
        batchId: batchId || null,
        compoundListId: compoundListId || null,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const selectClass =
    "w-44 px-1.5 py-1 text-[11px] bg-white border border-[#D1D5DB] text-[#111827] outline-none focus:border-[#2563EB]";

  return (
    <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-40">
      <div className="w-[520px] bg-white border border-[#D1D5DB] shadow-2xl flex flex-col" style={{ borderRadius: 0 }}>
        <div className="flex items-center justify-between px-3 h-8 bg-[#F3F4F6] border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-[#374151]">Assign upload metadata</span>
          </div>
          <button onClick={onClose} className="w-7 h-full flex items-center justify-center text-[#6B7280] hover:bg-[#DC2626] hover:text-white transition-colors">✕</button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <p className="text-[11px] text-[#6B7280]">
            Per-file mode is enabled. Choose the method, column, batch and compound list for <span className="font-medium text-[#111827]">{item.filename}</span>.
          </p>

          <div className="flex items-center gap-4">
            <label className="w-24 text-[10px] text-[#6B7280] text-right">Method</label>
            <select value={methodId} onChange={(e) => setMethodId(e.target.value)} className={selectClass} style={{ borderRadius: 2 }}>
              <option value="">—</option>
              {labData.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="w-24 text-[10px] text-[#6B7280] text-right">Column</label>
            <select value={columnId} onChange={(e) => setColumnId(e.target.value)} className={selectClass} style={{ borderRadius: 2 }}>
              <option value="">—</option>
              {labData.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {!columnId && <span className="text-[10px] text-[#B45309]">No column selected</span>}
          </div>

          <div className="flex items-center gap-4">
            <label className="w-24 text-[10px] text-[#6B7280] text-right">Batch</label>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={selectClass} style={{ borderRadius: 2 }}>
              <option value="">—</option>
              {labData.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="w-24 text-[10px] text-[#6B7280] text-right">Compound list</label>
            <select value={compoundListId} onChange={(e) => setCompoundListId(e.target.value)} className={selectClass} style={{ borderRadius: 2 }}>
              <option value="">—</option>
              {labData.compoundLists.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
            </select>
          </div>

          {folder && (
            <button onClick={onUseFolder} className="self-start text-[10px] text-[#2563EB] hover:underline">
              Use folder defaults
            </button>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#E5E7EB] bg-[#F9FAFB]">
          <button onClick={onClose} className="px-4 py-1.5 text-[11px] font-medium text-[#374151] border border-[#D1D5DB] bg-white hover:bg-[#F3F4F6] transition-colors" style={{ borderRadius: 2 }}>
            Cancel
          </button>
          <button onClick={() => void onSave()} disabled={saving} className="px-5 py-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] disabled:opacity-50 text-white text-[11px] font-semibold transition-colors" style={{ borderRadius: 2 }}>
            {saving ? "Saving…" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
