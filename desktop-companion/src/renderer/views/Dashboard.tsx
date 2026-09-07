import { useEffect, useState } from "react";
import type { DashboardStats, WatchFolder } from "@shared/ipc-types";
import { Icons, HourlyBarChart } from "../components/ui";
import { useDashboardStats, useHourlyUploads, useWatchFolders } from "../hooks/useDesktop";

export interface DashboardProps {
  onOpenModal: () => void;
}

export function Dashboard({ onOpenModal }: DashboardProps) {
  const { stats } = useDashboardStats();
  const hourly = useHourlyUploads();
  const { folders } = useWatchFolders();
  const activeDirs = folders.filter((f) => f.enabled).length;

  const cards = buildStatCards(stats);
  const watcherOk = stats.watcherStatus === "watching";

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full bg-[#F9FAFB]">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-2.5">
        {cards.map((s) => (
          <div key={s.label} className="bg-white border border-[#E5E7EB] p-3 flex flex-col gap-1.5 hover:border-[#D1D5DB] transition-colors" style={{ borderRadius: 2 }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[#6B7280] font-medium leading-tight">{s.label}</span>
              <span className="w-6 h-6 flex items-center justify-center rounded-sm" style={{ background: s.bg, color: s.color }}>{s.icon}</span>
            </div>
            <span className="text-[28px] font-semibold leading-none" style={{ color: s.color }}>{s.value}</span>
            <span className="text-[10px] text-[#9CA3AF]">{s.sub}</span>
          </div>
        ))}
      </div>

      {/* Uploads per hour */}
      <div className="bg-white border border-[#E5E7EB] p-3 flex-1 min-h-0" style={{ borderRadius: 2 }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-semibold text-[#111827]">Uploads per Hour</span>
          <span className="text-[10px] text-[#9CA3AF]">Last 24 h</span>
        </div>
        <HourlyBarChart data={hourly} />
      </div>

      {/* Watcher status */}
      <div className="bg-white border border-[#E5E7EB] px-3 py-2.5 flex items-center gap-3" style={{ borderRadius: 2 }}>
        <span className="relative flex items-center justify-center w-3 h-3">
          <span className={watcherOk ? "absolute w-3 h-3 rounded-full bg-[#16A34A] opacity-25 pulse-dot" : "absolute w-3 h-3 rounded-full bg-[#D97706] opacity-25 pulse-dot"} />
          <span className={watcherOk ? "w-2 h-2 rounded-full bg-[#16A34A]" : "w-2 h-2 rounded-full bg-[#D97706]"} />
        </span>
        <span className="text-[12px] text-[#374151] flex-1">
          {watcherOk
            ? <>Actively watching <strong className="text-[#111827]">{activeDirs} directories</strong> for .mzXML files</>
            : <strong className="text-[#111827]">Watcher paused</strong>}
        </span>
        <button onClick={onOpenModal} className="px-3 py-1 text-[11px] font-medium text-[#DC2626] border border-[#FECACA] bg-[#FEF2F2] hover:bg-[#FEE2E2] transition-colors" style={{ borderRadius: 2 }}>
          Stop Watcher
        </button>
        <button onClick={onOpenModal} className="px-3 py-1 text-[11px] font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors" style={{ borderRadius: 2 }}>
          View Active Upload
        </button>
      </div>

      <DashboardToast />
    </div>
  );
}

function buildStatCards(stats: DashboardStats) {
  return [
    { label: "Files Detected Today", value: String(stats.filesDetected), sub: "since midnight",   icon: Icons.eye,     color: "#2563EB", bg: "#EBF1FE" },
    { label: "Uploads Succeeded",    value: String(stats.uploadsSucceeded), sub: "all valid",     icon: Icons.check,   color: "#16A34A", bg: "#ECFDF3" },
    { label: "Uploads Failed",       value: String(stats.uploadsFailed),    sub: "needs attention", icon: Icons.xCircle, color: "#DC2626", bg: "#FEF2F2" },
    { label: "Queue Depth",          value: String(stats.queueDepth),       sub: "pending upload",  icon: Icons.layers,  color: "#2563EB", bg: "#EBF1FE" },
  ];
}

// Toast shown bottom-right, fed by the desktop onToast event.
function DashboardToast() {
  const [toast, setToast] = useState<{ type: string; message: string } | null>(null);

  useEffect(() => {
    const d = window.desktop;
    if (!d) return;
    d.onToast((t) => {
      setToast(t);
      window.setTimeout(() => setToast(null), 4000);
    });
  }, []);

  if (!toast) return null;
  const ok = toast.type !== "error" && toast.type !== "failed";
  return (
    <div className="fixed bottom-[128px] right-3 w-[300px] bg-white border border-[#E5E7EB] flex overflow-hidden shadow-lg toast-in z-20" style={{ borderRadius: 2 }}>
      <div className={ok ? "w-1 shrink-0 bg-[#16A34A]" : "w-1 shrink-0 bg-[#DC2626]"} />
      <div className="px-3 py-2.5 flex items-start gap-2">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="mt-0.5 shrink-0">
          <circle cx="8" cy="8" r="6" fill={ok ? "#16A34A" : "#DC2626"} />
          {ok
            ? <path d="M5.5 8l2 2 3-3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            : <path d="M6 6l4 4M10 6l-4 4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />}
        </svg>
        <div>
          <p className="text-[11px] font-semibold text-[#111827]">{toast.message}</p>
          <p className="text-[10px] text-[#6B7280] mt-0.5">just now</p>
        </div>
      </div>
    </div>
  );
}
