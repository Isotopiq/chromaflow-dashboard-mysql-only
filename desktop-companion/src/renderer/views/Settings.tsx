import { useState, useEffect } from "react";
import type { AppSettings } from "@shared/ipc-types";
import { cn, Toggle } from "../components/ui";
import { useSettings } from "../hooks/useDesktop";

type SettingsSection = "api" | "upload" | "appearance" | "notifications";

const DEFAULT_SETTINGS: AppSettings = {
  apiEndpoint: "http://localhost:29473",
  token: null,
  userEmail: null,
  maxConcurrentUploads: 3,
  defaultStabilizeSeconds: 30,
  defaultMaxRetries: 3,
  notifications: true,
  logLevel: "INFO",
  minimizeToTray: true,
  autoStart: false,
};

const settingsSections: { id: SettingsSection; label: string; desc: string }[] = [
  { id: "api",           label: "API & Connection",  desc: "Endpoint, auth token, connectivity" },
  { id: "upload",        label: "Upload Behavior",   desc: "Delays, retries, post-upload actions" },
  { id: "appearance",    label: "Appearance",        desc: "Theme, font size, log verbosity" },
  { id: "notifications", label: "Notifications",     desc: "System tray alerts, sound, badges" },
];

export function Settings() {
  const { settings, save, testConnection } = useSettings();
  const [section, setSection] = useState<SettingsSection>("api");
  const [showToken, setShowToken] = useState(false);
  const [connected, setConnected] = useState<{ ok: boolean; latencyMs: number } | null>(null);
  const [testing, setTesting] = useState(false);

  const [draft, setDraft] = useState<AppSettings>(settings ?? DEFAULT_SETTINGS);

  // Keep draft in sync once the real settings have loaded.
  useEffect(() => { if (settings) setDraft(settings); }, [settings]);

  const update = (patch: Partial<AppSettings>) => setDraft((prev) => ({ ...prev, ...patch }));

  const inp = "px-2.5 py-1.5 text-[12px] bg-white border border-[#D1D5DB] text-[#111827] placeholder-[#9CA3AF] outline-none focus:border-[#2563EB] transition-colors w-full";

  const active = settingsSections.find((s) => s.id === section)!;

  const onTest = async () => {
    setTesting(true);
    setConnected(null);
    try {
      const res = await testConnection();
      setConnected(res);
    } catch {
      setConnected({ ok: false, latencyMs: 0 });
    } finally {
      setTesting(false);
    }
  };

  const onSave = () => void save(draft);

  return (
    <div className="flex h-full bg-[#F9FAFB] w-full">
      {/* Left: category list */}
      <div className="w-52 shrink-0 border-r border-[#E5E7EB] bg-white flex flex-col">
        <div className="px-3 py-3 border-b border-[#E5E7EB]">
          <p className="text-[10px] font-semibold text-[#9CA3AF] uppercase tracking-widest">Settings</p>
        </div>
        <nav className="flex-1 py-1 overflow-y-auto">
          {settingsSections.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 flex flex-col gap-0.5 transition-colors relative",
                section === s.id ? "bg-[#EBF1FE] text-[#2563EB]" : "text-[#374151] hover:bg-[#F9FAFB]"
              )}
            >
              {section === s.id && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-[#2563EB]" />}
              <span className={cn("text-[12px] font-semibold", section === s.id ? "text-[#2563EB]" : "text-[#111827]")}>{s.label}</span>
              <span className="text-[10px] text-[#9CA3AF] leading-tight">{s.desc}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Right: content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="px-6 py-3 border-b border-[#E5E7EB] bg-white shrink-0">
          <h2 className="text-[13px] font-semibold text-[#111827]">{active.label}</h2>
          <p className="text-[11px] text-[#6B7280] mt-0.5">{active.desc}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-2">
          {section === "api" && (
            <div>
              <SettingsField label="V3 API Endpoint" hint="Base URL for the Isotopiq V3 API">
                <input className={inp} style={{ borderRadius: 2 }} value={draft.apiEndpoint} onChange={(e) => update({ apiEndpoint: e.target.value })} />
              </SettingsField>
              <SettingsField label="Auth Token" hint="Bearer token for API authentication">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showToken ? "text" : "password"}
                      className={inp}
                      style={{ borderRadius: 2 }}
                      value={draft.token ?? ""}
                      onChange={(e) => update({ token: e.target.value || null })}
                      placeholder="Not set — log in to authenticate"
                    />
                    <button onClick={() => setShowToken((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-semibold text-[#6B7280] hover:text-[#2563EB] uppercase tracking-wide">{showToken ? "Hide" : "Show"}</button>
                  </div>
                  <button onClick={() => void onTest()} disabled={testing} className="px-3 py-1.5 text-[11px] font-medium border border-[#D1D5DB] bg-white hover:bg-[#F3F4F6] text-[#374151] whitespace-nowrap shrink-0 disabled:opacity-50" style={{ borderRadius: 2 }}>
                    {testing ? "Testing…" : "Test Connection"}
                  </button>
                  {connected && (
                    <span className={cn("flex items-center gap-1.5 text-[11px] font-semibold px-2.5 whitespace-nowrap shrink-0 border", connected.ok ? "text-[#16A34A] bg-[#ECFDF3] border-[#BBF7D0]" : "text-[#DC2626] bg-[#FEF2F2] border-[#FECACA]")} style={{ borderRadius: 2 }}>
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill={connected.ok ? "#16A34A" : "#DC2626"}/>{connected.ok ? <path d="M3 5l1.5 1.5 2.5-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/> : <path d="M3.5 3.5l3 3M6.5 3.5l-3 3" stroke="white" strokeWidth="1.2" strokeLinecap="round"/>}</svg>
                      {connected.ok ? `${connected.latencyMs} ms` : "Failed"}
                    </span>
                  )}
                </div>
              </SettingsField>
              <SettingsField label="Logged in as" hint="Authenticated user email">
                <span className="text-[12px] text-[#374151]">{draft.userEmail ?? "Not authenticated"}</span>
              </SettingsField>
              <SettingsField label="Minimize to tray" hint="Hide the window to the system tray on close">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={draft.minimizeToTray} onChange={(v) => update({ minimizeToTray: v })} />
                  <span className="text-[11px] text-[#374151]">Minimize to tray on close</span>
                </label>
              </SettingsField>
            </div>
          )}

          {section === "upload" && (
            <div>
              <SettingsField label="Default pre-upload delay" hint="Wait after a file stabilises before uploading">
                <div className="flex items-center gap-2">
                  <input type="number" value={draft.defaultStabilizeSeconds} onChange={(e) => update({ defaultStabilizeSeconds: Number(e.target.value) })} className={cn(inp, "w-20")} style={{ borderRadius: 2 }} />
                  <span className="text-[11px] text-[#6B7280]">seconds</span>
                </div>
              </SettingsField>
              <SettingsField label="Default max retries" hint="How many times to retry a failed upload before marking it as failed">
                <div className="flex items-center">
                  <button onClick={() => update({ defaultMaxRetries: Math.max(0, draft.defaultMaxRetries - 1) })} className="w-8 h-7 border border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F3F4F6]" style={{ borderRadius: "2px 0 0 2px" }}>−</button>
                  <div className="w-10 h-7 border-t border-b border-[#D1D5DB] bg-[#F9FAFB] flex items-center justify-center text-[12px] font-medium text-[#111827]">{draft.defaultMaxRetries}</div>
                  <button onClick={() => update({ defaultMaxRetries: Math.min(10, draft.defaultMaxRetries + 1) })} className="w-8 h-7 border border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F3F4F6]" style={{ borderRadius: "0 2px 2px 0" }}>+</button>
                </div>
              </SettingsField>
              <SettingsField label="Concurrent uploads" hint="Maximum number of files uploading at the same time">
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={10} value={draft.maxConcurrentUploads} onChange={(e) => update({ maxConcurrentUploads: Number(e.target.value) })} className={cn(inp, "w-20")} style={{ borderRadius: 2 }} />
                  <span className="text-[11px] text-[#6B7280]">max parallel</span>
                </div>
              </SettingsField>
              <SettingsField label="Auto-start watching" hint="Start watching configured directories on launch">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={draft.autoStart} onChange={(v) => update({ autoStart: v })} />
                  <span className="text-[11px] text-[#374151]">Start watching on app launch</span>
                </label>
              </SettingsField>
            </div>
          )}

          {section === "appearance" && (
            <div>
              <SettingsField label="Theme" hint="Application color scheme">
                <div className="flex border border-[#D1D5DB] w-fit overflow-hidden" style={{ borderRadius: 2 }}>
                  {["Dark", "Light", "System"].map((t) => (
                    <button key={t} className={cn("px-5 py-1.5 text-[11px] font-medium transition-colors border-r border-[#D1D5DB] last:border-0", t === "Light" ? "bg-[#EBF1FE] text-[#2563EB]" : "text-[#6B7280] hover:bg-[#F3F4F6]")}>{t}</button>
                  ))}
                </div>
              </SettingsField>
              <SettingsField label="Log level" hint="Minimum severity level to show in the output panel">
                <select value={draft.logLevel} onChange={(e) => update({ logLevel: e.target.value as AppSettings["logLevel"] })} className="px-2 py-1.5 text-[12px] bg-white border border-[#D1D5DB] text-[#111827] outline-none focus:border-[#2563EB] w-36" style={{ borderRadius: 2 }}>
                  {["DEBUG", "INFO", "WARN", "ERROR"].map((l) => <option key={l}>{l}</option>)}
                </select>
              </SettingsField>
              <SettingsField label="Show file extensions" hint="Display .mzXML suffix in file lists">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={true} onChange={() => {}} />
                  <span className="text-[12px] text-[#374151]">Always show file extensions</span>
                </label>
              </SettingsField>
              <SettingsField label="Compact rows" hint="Reduce row height in tables for higher density">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={false} onChange={() => {}} />
                  <span className="text-[12px] text-[#374151]">Use compact table rows</span>
                </label>
              </SettingsField>
            </div>
          )}

          {section === "notifications" && (
            <div>
              <SettingsField label="Desktop notifications" hint="Show Windows system notifications on upload events">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={draft.notifications} onChange={(v) => update({ notifications: v })} />
                  <span className="text-[12px] text-[#374151]">Enable desktop notifications</span>
                </label>
              </SettingsField>
              <SettingsField label="Notification sound" hint="Play a sound when an upload completes or fails">
                <label className={cn("flex items-center gap-2 cursor-pointer", !draft.notifications && "opacity-40 pointer-events-none")}>
                  <Toggle checked={false} onChange={() => {}} />
                  <span className="text-[12px] text-[#374151]">Play sound on completion</span>
                </label>
              </SettingsField>
              <SettingsField label="Notify on" hint="Which events trigger a notification">
                <div className="flex flex-col gap-2">
                  {["Upload success", "Upload failure", "Watcher stopped", "Queue empty"].map((ev) => (
                    <label key={ev} className={cn("flex items-center gap-2 cursor-pointer", !draft.notifications && "opacity-40 pointer-events-none")}>
                      <input type="checkbox" defaultChecked={ev !== "Queue empty"} className="w-3.5 h-3.5 accent-[#2563EB]" />
                      <span className="text-[12px] text-[#374151]">{ev}</span>
                    </label>
                  ))}
                </div>
              </SettingsField>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-6 py-3 border-t border-[#E5E7EB] bg-white shrink-0 flex items-center justify-between">
          <button onClick={() => setDraft(settings ?? DEFAULT_SETTINGS)} className="text-[11px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors">Reset to defaults</button>
          <div className="flex items-center gap-2">
            <button onClick={() => setDraft(settings ?? DEFAULT_SETTINGS)} className="px-4 py-1.5 text-[11px] font-medium border border-[#D1D5DB] bg-white hover:bg-[#F3F4F6] text-[#374151] transition-colors" style={{ borderRadius: 2 }}>Cancel</button>
            <button onClick={onSave} className="px-5 py-1.5 bg-[#2563EB] hover:bg-[#1D4ED8] text-white text-[11px] font-semibold transition-colors" style={{ borderRadius: 2 }}>Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-6 py-3.5 border-b border-[#F3F4F6] last:border-0">
      <div className="w-44 shrink-0 pt-0.5">
        <p className="text-[12px] font-medium text-[#374151]">{label}</p>
        {hint && <p className="text-[10px] text-[#9CA3AF] mt-0.5 leading-snug">{hint}</p>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
