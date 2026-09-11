import { useState, useEffect } from "react";
import isotopiqLogo from "../../resources/isotopiq-logo.png";
import type { View, WatcherStatus, LogEntry } from "@shared/ipc-types";
import { cn, Icons, MenuDropdown, type MenuItem } from "./components/ui";
import {
  useWindowControls,
  usePauseAll,
  useWatcherStatus,
  useLogEntries,
  useQueue,
} from "./hooks/useDesktop";
import { Dashboard } from "./views/Dashboard";
import { Queue } from "./views/Queue";
import { WatchDirectories } from "./views/WatchDirectories";
import { History } from "./views/History";
import { Settings } from "./views/Settings";
import { UploadModal } from "./views/UploadModal";
import { AssignModal } from "./views/AssignModal";
import type { QueueItem } from "@shared/ipc-types";

// ─── Nav config ───────────────────────────────────────────────────────────────
const navItems = [
  { id: "dashboard",   label: "Dashboard",        icon: Icons.dashboard },
  { id: "queue",       label: "Queue",             icon: Icons.queue },
  { id: "directories", label: "Watch Directories", icon: Icons.folders },
  { id: "history",     label: "Upload History",    icon: Icons.history },
  { id: "settings",    label: "Settings",          icon: Icons.settings },
] as const;

const viewTitles: Record<View, string> = {
  dashboard:   "Dashboard",
  queue:       "Upload Queue",
  directories: "Watch Directories",
  history:     "Upload History",
  settings:    "Settings",
};

// ─── Root app ─────────────────────────────────────────────────────────────────
export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [modalOpen, setModalOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [assignItem, setAssignItem] = useState<QueueItem | null>(null);

  const win = useWindowControls();
  const watcherStatus = useWatcherStatus();
  const { items } = useQueue();
  const paused = watcherStatus === "paused";

  // Listen for tray navigation events
  useEffect(() => {
    const off = window.desktop?.onNavigate?.((v) => setView(v as View));
    return () => off?.();
  }, []);

  // Listen for per-file metadata requests
  useEffect(() => {
    const d = window.desktop;
    if (!d) return;
    const off = d.onQueueNeedsConfig((item) => setAssignItem(item));
    return () => off?.();
  }, []);

  useEffect(() => { if (view !== "dashboard") setModalOpen(false); }, [view]);

  const pending = items.filter((i) => i.status === "queued" || i.status === "uploading" || i.status === "parsing" || i.status === "pending").length;

  const togglePause = () => {
    if (paused) window.desktop?.resumeAll();
    else window.desktop?.pauseAll();
  };

  const onMaximize = () => {
    win.maximize();
    setMaximized((m) => !m);
  };

  return (
    <div
      className="flex flex-col bg-white text-[#111827] overflow-hidden"
      style={{ width: "100%", height: "100%", minWidth: 1080, minHeight: 580, fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Windows chrome */}
      <TitleBar maximized={maximized} onMaximize={onMaximize} onMinimize={() => win.minimize()} onClose={() => win.close()} />
      <MenuBar onNavigate={setView} onPause={() => void togglePause()} onResume={() => void togglePause()} paused={paused} onAbout={() => setAboutOpen(true)} />

      {/* App shell */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div className="flex flex-col bg-[#F9FAFB] border-r border-[#E5E7EB] shrink-0" style={{ width: 196 }}>
          {/* Logo */}
          <div className="px-3 py-3 border-b border-[#E5E7EB]">
            <img src={isotopiqLogo} alt="Isotopiq" className="h-7 object-contain" />
            <p className="text-[9px] font-semibold text-[#9CA3AF] uppercase tracking-widest mt-1 pl-0.5">V3 Companion</p>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-1">
            {navItems.map((item) => {
              const active = view === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setView(item.id as View)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 h-9 text-[12px] transition-colors relative text-left",
                    active ? "bg-[#EBF1FE] text-[#2563EB] font-semibold" : "text-[#374151] hover:bg-[#F3F4F6] font-medium"
                  )}
                >
                  {active && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2563EB]" />}
                  <span className={active ? "text-[#2563EB]" : "text-[#9CA3AF]"}>{item.icon}</span>
                  {item.label}
                </button>
              );
            })}
          </nav>

          {/* Bottom status */}
          <div className="px-3 py-3 border-t border-[#E5E7EB] flex flex-col gap-1">
            <div className={cn("flex items-center gap-1.5 text-[11px] font-medium", pending > 0 ? "text-[#2563EB]" : watcherStatus === "watching" ? "text-[#16A34A]" : watcherStatus === "paused" ? "text-[#D97706]" : watcherStatus === "error" ? "text-[#DC2626]" : "text-[#9CA3AF]")}>
              <span className={cn("w-2 h-2 rounded-full shrink-0", pending > 0 ? "bg-[#2563EB] pulse-dot" : watcherStatus === "watching" ? "bg-[#16A34A] pulse-dot" : watcherStatus === "paused" ? "bg-[#D97706]" : watcherStatus === "error" ? "bg-[#DC2626]" : "bg-[#9CA3AF]")} />
              {pending > 0 ? `Processing ${pending} file${pending !== 1 ? "s" : ""}` : watcherStatus === "watching" ? "Watching" : watcherStatus === "paused" ? "Paused" : watcherStatus === "error" ? "Error" : "Idle"}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Toolbar / top bar */}
          <div className="flex items-center px-3 border-b border-[#E5E7EB] bg-white shrink-0 gap-2" style={{ height: 36 }}>
            <h1 className="text-[13px] font-semibold text-[#111827] flex-1">{viewTitles[view]}</h1>
            <button
              onClick={() => void togglePause()}
              className={cn(
                "h-7 px-3 text-[11px] font-medium border transition-colors",
                paused
                  ? "bg-[#FEF3C7] border-[#FCD34D] text-[#92400E]"
                  : "border-[#D1D5DB] text-[#374151] hover:bg-[#F3F4F6]"
              )}
              style={{ borderRadius: 2 }}
            >
              {paused ? "▶ Resume All" : "⏸ Pause All"}
            </button>
            <div className="relative">
              <button
                onClick={() => setNotifOpen((o) => !o)}
                className={cn("w-7 h-7 flex items-center justify-center text-[#6B7280] hover:bg-[#F3F4F6] relative transition-colors", notifOpen && "bg-[#F3F4F6]")}
                style={{ borderRadius: 2 }}
                title="Notifications"
              >
                {Icons.bell}
                {pending > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-[#2563EB] rounded-full" />}
              </button>
              {notifOpen && <NotificationsPanel pending={pending} onClose={() => setNotifOpen(false)} onNavigate={setView} />}
            </div>
            <div className="w-6 h-6 rounded-sm bg-[#EBF1FE] border border-[#BFCFFB] flex items-center justify-center text-[9px] font-bold text-[#2563EB]">V3</div>
          </div>

          {/* View */}
          <div className="flex-1 min-h-0 relative">
            {view === "dashboard"   && <Dashboard onOpenModal={() => setModalOpen(true)} />}
            {view === "queue"       && <Queue onAssign={setAssignItem} />}
            {view === "directories" && <WatchDirectories />}
            {view === "history"     && <History />}
            {view === "settings"    && <Settings />}
            {modalOpen && view === "dashboard" && <UploadModal onClose={() => setModalOpen(false)} />}
            {assignItem && <AssignModal item={assignItem} onClose={() => setAssignItem(null)} />}
          </div>

          {/* Log / output panel */}
          <LogPanel />
        </div>
      </div>

      {/* Windows status bar */}
      <StatusBar watcherStatus={watcherStatus} pending={pending} />

      {/* About dialog */}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

// ─── Windows title bar ────────────────────────────────────────────────────────
function TitleBar({
  maximized,
  onMaximize,
  onMinimize,
  onClose,
}: {
  maximized: boolean;
  onMaximize: () => void;
  onMinimize: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center bg-[#F3F4F6] border-b border-[#E5E7EB] shrink-0 select-none" style={{ height: 32 }}>
      <div className="flex items-center gap-2 pl-3 flex-1 min-w-0">
        <img src={isotopiqLogo} alt="Isotopiq" className="h-4 object-contain shrink-0" />
        <span className="text-[11px] text-[#6B7280] font-medium truncate">V3 Companion</span>
      </div>

      <div className="flex items-stretch h-full shrink-0">
        <button onClick={onMinimize} className="w-[46px] flex items-center justify-center text-[#374151] hover:bg-[#E5E7EB] transition-colors" title="Minimize">
          {Icons.winMin}
        </button>
        <button onClick={onMaximize} className="w-[46px] flex items-center justify-center text-[#374151] hover:bg-[#E5E7EB] transition-colors" title={maximized ? "Restore" : "Maximize"}>
          {maximized ? Icons.winRestore : Icons.winMax}
        </button>
        <button onClick={onClose} className="w-[46px] flex items-center justify-center text-[#374151] hover:bg-[#C42B1C] hover:text-white transition-colors" title="Close">
          {Icons.winClose}
        </button>
      </div>
    </div>
  );
}

// ─── Windows menu bar ─────────────────────────────────────────────────────────
function MenuBar({ onNavigate, onPause, onResume, paused, onAbout }: { onNavigate: (v: View) => void; onPause: () => void; onResume: () => void; paused: boolean; onAbout: () => void }) {
  const fileItems: MenuItem[] = [
    { label: "New Watch Directory", action: () => onNavigate("directories") },
    { separator: true },
    { label: "Export Upload History…", action: () => onNavigate("history") },
    { separator: true },
    { label: "Exit", action: () => window.desktop?.quitApp() },
  ];

  const editItems: MenuItem[] = [
    { label: "Clear Queue", action: () => window.desktop?.clearQueue("all") },
    { separator: true },
    { label: "Preferences", action: () => onNavigate("settings") },
  ];

  const viewItems: MenuItem[] = [
    { label: "Dashboard", action: () => onNavigate("dashboard") },
    { label: "Queue", action: () => onNavigate("queue") },
    { label: "Watch Directories", action: () => onNavigate("directories") },
    { label: "Upload History", action: () => onNavigate("history") },
    { separator: true },
    { label: "Settings", action: () => onNavigate("settings") },
  ];

  const watcherItems: MenuItem[] = [
    { label: paused ? "Resume All" : "Pause All", action: () => paused ? onResume() : onPause() },
    { separator: true },
    { label: "Clear Queue", action: () => window.desktop?.clearQueue("all") },
  ];

  const helpItems: MenuItem[] = [
    { label: "Documentation", action: () => window.open("https://github.com/ddlidded/chromaflow-dashboard-mysql-only", "_blank") },
    { separator: true },
    { label: "About V3 Companion", action: onAbout },
  ];

  return (
    <div className="flex items-stretch bg-white border-b border-[#E5E7EB] shrink-0" style={{ height: 24 }}>
      <MenuDropdown label="File" items={fileItems} />
      <MenuDropdown label="Edit" items={editItems} />
      <MenuDropdown label="View" items={viewItems} />
      <MenuDropdown label="Watcher" items={watcherItems} />
      <MenuDropdown label="Help" items={helpItems} />
    </div>
  );
}

// ─── Status bar ───────────────────────────────────────────────────────────────
function StatusBar({ watcherStatus, pending }: { watcherStatus: WatcherStatus; pending: number }) {
  const info = {
    watching: { dot: "bg-[#16A34A]", text: "Watching directories" },
    paused:   { dot: "bg-[#D97706]", text: "Watcher paused" },
    error:    { dot: "bg-[#DC2626]", text: "Watcher error" },
    idle:     { dot: "bg-[#9CA3AF]", text: "No directories configured" },
  }[watcherStatus];

  return (
    <div className="flex items-center px-3 bg-[#2563EB] border-t border-[#1D4ED8] shrink-0 gap-4" style={{ height: 22 }}>
      <div className="flex items-center gap-1.5">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", info.dot, watcherStatus === "watching" && "pulse-dot")} />
        <span className="text-[10px] text-white/90 font-medium">{info.text}</span>
      </div>
      <div className="w-px h-3 bg-white/20" />
      <span className="text-[10px] text-white/70">Queue: {pending} pending</span>
      <div className="flex-1" />
      <span className="text-[10px] text-white/60">v1.0.0</span>
    </div>
  );
}

// ─── Log panel ────────────────────────────────────────────────────────────────
function LogPanel() {
  const { entries, clear } = useLogEntries();
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "INFO" | "WARN" | "ERROR">("ALL");
  const filtered = filter === "ALL" ? entries : entries.filter((l: any) => l.level === filter);
  const levelColor = (lv: string) =>
    lv === "ERROR" ? "text-[#DC2626]" : lv === "WARN" ? "text-[#D97706]" : lv === "DEBUG" ? "text-[#9CA3AF]" : "text-[#6B7280]";

  return (
    <div className="border-t border-[#E5E7EB] bg-[#F3F4F6] shrink-0" style={{ height: collapsed ? 26 : 108 }}>
      <div className="flex items-center gap-2 px-3 h-[26px] border-b border-[#E5E7EB]">
        <span className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-widest">Output</span>
        {!collapsed && (["ALL", "INFO", "WARN", "ERROR"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("px-2 py-px text-[9px] font-semibold transition-colors", filter === f ? "bg-white border border-[#D1D5DB] text-[#111827]" : "text-[#9CA3AF] hover:text-[#6B7280]")} style={{ borderRadius: 2 }}>{f}</button>
        ))}
        <div className="flex-1" />
        {!collapsed && <button onClick={clear} className="text-[9px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors">Clear</button>}
        <button onClick={() => setCollapsed((c) => !c)} className="text-[#9CA3AF] hover:text-[#6B7280] transition-colors ml-1">
          {collapsed ? Icons.chevronUp : Icons.chevronDown}
        </button>
      </div>
      {!collapsed && (
        <div className="overflow-y-auto" style={{ height: 82 }}>
          {filtered.length === 0 && (
            <div className="px-3 py-1 text-[10px] text-[#9CA3AF] font-mono">No log output</div>
          )}
          {filtered.map((line: any, i: number) => (
            <div key={i} className="px-3 py-px flex items-start gap-2 hover:bg-white/50 transition-colors">
              <span className={cn("text-[10px] font-mono shrink-0 font-semibold mt-px", levelColor(line.level))}>[{line.level}]</span>
              <span className="text-[10px] font-mono text-[#6B7280] leading-relaxed">{formatLogMsg(line)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatLogMsg(entry: LogEntry): string {
  const ts = new Date(entry.timestamp);
  const hh = String(ts.getHours()).padStart(2, "0");
  const mm = String(ts.getMinutes()).padStart(2, "0");
  const ss = String(ts.getSeconds()).padStart(2, "0");
  return `[${hh}:${mm}:${ss}] ${entry.message}`;
}

// ─── About dialog ─────────────────────────────────────────────────────────────
function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 bg-black/20 flex items-center justify-center z-40" onClick={onClose}>
      <div
        className="w-[380px] bg-white border border-[#D1D5DB] shadow-2xl flex flex-col"
        style={{ borderRadius: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-3 h-8 bg-[#F3F4F6] border-b border-[#E5E7EB] shrink-0">
          <span className="text-[11px] font-semibold text-[#374151]">About V3 Companion</span>
          <button onClick={onClose} className="w-7 h-full flex items-center justify-center text-[#6B7280] hover:bg-[#DC2626] hover:text-white transition-colors">
            {Icons.winClose}
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col items-center px-6 py-6 gap-3">
          <img src={isotopiqLogo} alt="Isotopiq" className="h-12 object-contain" />
          <h2 className="text-[16px] font-bold text-[#111827]">V3 Companion</h2>
          <p className="text-[11px] text-[#9CA3AF]">Version 1.0.0</p>

          <div className="w-full h-px bg-[#E5E7EB] my-2" />

          <div className="flex flex-col gap-1.5 w-full text-center">
            <p className="text-[12px] text-[#374151]">
              <span className="font-semibold">Author:</span> Eddy Kapelczak
            </p>
            <p className="text-[12px] text-[#374151]">
              <span className="font-semibold">Organization:</span> Isotopiq Solutions
            </p>
            <p className="text-[12px] text-[#374151]">
              <span className="font-semibold">Release Date:</span> September 8, 2026
            </p>
          </div>

          <div className="w-full h-px bg-[#E5E7EB] my-2" />

          <p className="text-[10px] text-[#9CA3AF] text-center leading-relaxed">
            Windows desktop companion for ChromaFlow V3.<br />
            Watches directories for .mzXML / .mzML files and uploads to ChromaFlow.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-center px-6 pb-5">
          <button
            onClick={onClose}
            className="px-6 py-1.5 text-[11px] font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors"
            style={{ borderRadius: 2 }}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Notifications panel ──────────────────────────────────────────────────────
function NotificationsPanel({ pending, onClose, onNavigate }: { pending: number; onClose: () => void; onNavigate: (v: View) => void }) {
  const { entries } = useLogEntries(10);
  const recentErrors = entries.filter((e: any) => e.level === "ERROR");
  const recentWarns = entries.filter((e: any) => e.level === "WARN");

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 w-80 bg-white border border-[#D1D5DB] shadow-lg flex flex-col" style={{ borderRadius: 0 }}>
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#E5E7EB] bg-[#F9FAFB] shrink-0">
          <span className="text-[11px] font-semibold text-[#111827]">Notifications</span>
          <button onClick={onClose} className="text-[#9CA3AF] hover:text-[#6B7280]">{Icons.winClose}</button>
        </div>
        <div className="flex-1 overflow-y-auto max-h-80">
          {pending > 0 && (
            <div className="px-3 py-2.5 border-b border-[#F3F4F6] flex items-center gap-2.5 hover:bg-[#F9FAFB] cursor-pointer" onClick={() => { onNavigate("queue"); onClose(); }}>
              <span className="w-7 h-7 flex items-center justify-center bg-[#EBF1FE] text-[#2563EB] shrink-0" style={{ borderRadius: 2 }}>{Icons.queue}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[#111827]">{pending} upload{pending !== 1 ? "s" : ""} in progress</p>
                <p className="text-[10px] text-[#9CA3AF]">Click to view queue</p>
              </div>
            </div>
          )}
          {recentErrors.length === 0 && recentWarns.length === 0 && pending === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-[11px] text-[#9CA3AF]">No notifications</p>
            </div>
          )}
          {recentErrors.slice(0, 5).map((e: any, i: number) => (
            <div key={`err-${i}`} className="px-3 py-2.5 border-b border-[#F3F4F6] flex items-start gap-2.5">
              <span className="w-7 h-7 flex items-center justify-center bg-[#FEF2F2] text-[#DC2626] shrink-0 mt-0.5" style={{ borderRadius: 2 }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 6l4 4M10 6l-4 4" strokeLinecap="round"/></svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[#DC2626]">Error</p>
                <p className="text-[10px] text-[#6B7280] truncate">{e.message}</p>
              </div>
            </div>
          ))}
          {recentWarns.slice(0, 5).map((w: any, i: number) => (
            <div key={`warn-${i}`} className="px-3 py-2.5 border-b border-[#F3F4F6] flex items-start gap-2.5">
              <span className="w-7 h-7 flex items-center justify-center bg-[#FEF3C7] text-[#D97706] shrink-0 mt-0.5" style={{ borderRadius: 2 }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 2L1 14h14L8 2z" strokeLinejoin="round"/><path d="M8 7v3M8 12v.5" strokeLinecap="round"/></svg>
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[#D97706]">Warning</p>
                <p className="text-[10px] text-[#6B7280] truncate">{w.message}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-[#E5E7EB] bg-[#F9FAFB] shrink-0">
          <button onClick={() => { onNavigate("history"); onClose(); }} className="text-[10px] text-[#2563EB] hover:text-[#1D4ED8] font-medium">View upload history →</button>
        </div>
      </div>
    </>
  );
}
