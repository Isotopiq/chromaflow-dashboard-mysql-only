import { useState } from "react";
import type { WatchFolder } from "@shared/ipc-types";
import { cn, Icons, Toggle } from "../components/ui";
import { useWatchFolders, useLabData } from "../hooks/useDesktop";

export function WatchDirectories() {
  const { folders, add, update, remove, pickDirectory, error } = useWatchFolders();
  const labData = useLabData();

  const onAdd = async () => {
    const dir = await pickDirectory();
    if (!dir) return;
    await add({
      path: dir,
      enabled: true,
      recursive: true,
      stabilizeSeconds: 30,
      archiveBehavior: "leave",
      archivePath: null,
      maxRetries: 3,
      filePattern: "*.mzXML",
    });
  };

  return (
    <div className="p-3 flex flex-col gap-2.5 overflow-y-auto h-full bg-[#F9FAFB]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#111827]">{folders.length} directories configured</span>
        <button
          onClick={() => void onAdd()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2563EB] text-white text-[11px] font-semibold hover:bg-[#1D4ED8] transition-colors shadow-sm"
          style={{ borderRadius: 2 }}
        >
          + Add Directory
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#FEF2F2] border border-[#FECACA] text-[11px] text-[#DC2626]" style={{ borderRadius: 2 }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 6l4 4M10 6l-4 4" strokeLinecap="round"/></svg>
          {error}
        </div>
      )}

      {folders.some((d) => d.enabled && !d.columnId) && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#FFFBEB] border border-[#FDE68A] text-[11px] text-[#B45309]" style={{ borderRadius: 2 }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 4v5M8 11h.01" strokeLinecap="round"/><circle cx="8" cy="8" r="6"/></svg>
          One or more enabled folders have no column selected. Runs will still upload, but they will not appear in the Column/Method/Batch portal views until a column is assigned.
        </div>
      )}

      {folders.map((dir) => (
        <WatchDirRow
          key={dir.id}
          dir={dir}
          labData={labData}
          onUpdate={(patch) => void update({ ...dir, ...patch })}
          onRemove={() => void remove(dir.id)}
        />
      ))}

      {folders.length === 0 && (
        <div className="flex flex-col items-center justify-center py-6 border border-dashed border-[#D1D5DB] bg-white gap-2" style={{ borderRadius: 2 }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" stroke="#D1D5DB" strokeWidth="1.5">
            <path d="M4 10A3 3 0 017 7h6l3 4H25a3 3 0 013 3v10a3 3 0 01-3 3H7a3 3 0 01-3-3V10z"/>
            <path d="M16 16v6M13 19h6" strokeLinecap="round"/>
          </svg>
          <p className="text-[11px] text-[#9CA3AF] text-center">Add directories above to start watching for .mzXML files</p>
        </div>
      )}
    </div>
  );
}

function WatchDirRow({
  dir,
  labData,
  onUpdate,
  onRemove,
}: {
  dir: WatchFolder;
  labData: { methods: { id: string; name: string }[]; columns: { id: string; name: string }[]; batches: { id: string; name: string }[]; compoundLists: { id: string; name: string }[] };
  onUpdate: (patch: Partial<WatchFolder>) => void;
  onRemove: () => void;
}) {
  const [stabilize, setStabilize] = useState(dir.stabilizeSeconds);

  const selectClass =
    "px-1.5 py-1 text-[11px] bg-white border border-[#D1D5DB] text-[#111827] outline-none focus:border-[#2563EB]";

  return (
    <div
      className={cn("bg-white border border-[#E5E7EB] px-3 py-2.5 flex flex-col gap-2 hover:border-[#D1D5DB] transition-colors", !dir.enabled && "opacity-55")}
      style={{ borderRadius: 2 }}
    >
      <div className="flex items-center gap-3">
        <div className="shrink-0">{Icons.folder}</div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-medium text-[#111827] truncate font-mono">{dir.path}</p>
          <p className="text-[10px] text-[#9CA3AF] mt-0.5">{dir.enabled ? "Watching for .mzXML files" : "Watching paused"}</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Toggle checked={dir.recursive} onChange={(v) => onUpdate({ recursive: v })} />
            <span className="text-[11px] text-[#6B7280]">Recursive</span>
          </label>
          <div className="flex items-center gap-1 border border-[#D1D5DB] bg-[#F9FAFB] px-2 py-1" style={{ borderRadius: 2 }}>
            <input
              type="number"
              value={stabilize}
              onChange={(e) => setStabilize(Number(e.target.value))}
              onBlur={() => onUpdate({ stabilizeSeconds: stabilize })}
              className="w-7 text-[11px] text-[#111827] bg-transparent outline-none text-center"
            />
            <span className="text-[10px] text-[#9CA3AF]">s delay</span>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Toggle checked={dir.enabled} onChange={(v) => onUpdate({ enabled: v })} />
            <span className="text-[11px] text-[#6B7280]">Active</span>
          </label>
          <button onClick={onRemove} className="p-1.5 text-[#9CA3AF] hover:text-[#DC2626] hover:bg-[#FEF2F2] rounded-sm transition-colors">{Icons.trash}</button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap pl-7">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#6B7280]">Method</span>
          <select
            value={dir.methodId || ""}
            onChange={(e) => onUpdate({ methodId: e.target.value || null })}
            className={cn(selectClass, !dir.methodId && "border-[#FDE68A] bg-[#FFFBEB]")}
            style={{ borderRadius: 2 }}
          >
            <option value="">—</option>
            {labData.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={cn("text-[10px]", !dir.columnId ? "text-[#B45309] font-medium" : "text-[#6B7280]")}>Column</span>
          <select
            value={dir.columnId || ""}
            onChange={(e) => onUpdate({ columnId: e.target.value || null })}
            className={cn(selectClass, !dir.columnId && "border-[#FDE68A] bg-[#FFFBEB]")}
            style={{ borderRadius: 2 }}
          >
            <option value="">— choose —</option>
            {labData.columns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#6B7280]">Batch</span>
          <select
            value={dir.batchId || ""}
            onChange={(e) => onUpdate({ batchId: e.target.value || null })}
            className={selectClass}
            style={{ borderRadius: 2 }}
          >
            <option value="">—</option>
            {labData.batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-[#6B7280]">Compound list</span>
          <select
            value={dir.compoundListId || ""}
            onChange={(e) => onUpdate({ compoundListId: e.target.value || null })}
            className={selectClass}
            style={{ borderRadius: 2 }}
          >
            <option value="">—</option>
            {labData.compoundLists.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}
