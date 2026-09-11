import { useState, useEffect } from "react";
import type { AppSettings } from "@shared/ipc-types";
import { cn, Toggle } from "../components/ui";
import { useSettings, useAuth } from "../hooks/useDesktop";

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
  stayLoggedIn: true,
  forgetProcessedOnDelete: true,
  uploadAssignmentMode: "per-folder",
};

const settingsSections: { id: SettingsSection; label: string; desc: string }[] = [
  { id: "api",           label: "API & Connection",  desc: "Endpoint, auth token, connectivity" },
  { id: "upload",        label: "Upload Behavior",   desc: "Delays, retries, post-upload actions" },
  { id: "appearance",    label: "Appearance",        desc: "Theme, font size, log verbosity" },
  { id: "notifications", label: "Notifications",     desc: "System tray alerts, sound, badges" },
];

export function Settings() {
  const { settings, save, testConnection } = useSettings();
  const { status: authStatus, login, logout } = useAuth();
  const [section, setSection] = useState<SettingsSection>("api");
  const [showToken, setShowToken] = useState(false);
  const [connected, setConnected] = useState<{ ok: boolean; latencyMs: number } | null>(null);
  const [testing, setTesting] = useState(false);

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

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
      // Save the endpoint first so testConnection uses the right URL
      await save({ apiEndpoint: draft.apiEndpoint });
      const res = await testConnection();
      setConnected(res);
    } catch {
      setConnected({ ok: false, latencyMs: 0 });
    } finally {
      setTesting(false);
    }
  };

  const onLogin = async () => {
    setLoginError(null);
    setLoggingIn(true);
    try {
      // Save the API endpoint first so the login call uses the right URL
      await save({ apiEndpoint: draft.apiEndpoint, stayLoggedIn: draft.stayLoggedIn });
      await login(loginEmail, loginPassword);
      setLoginPassword("");
    } catch (e: any) {
      setLoginError(e?.message ?? "Login failed");
    } finally {
      setLoggingIn(false);
    }
  };

  const onLogout = async () => {
    await logout();
    setLoginEmail("");
    setLoginPassword("");
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
              <SettingsField label="V3 API Endpoint" hint="Base URL for the Isotopiq V3 API (e.g. https://chroma.yourdomain.com)">
                <div className="flex gap-2">
                  <input className={inp} style={{ borderRadius: 2 }} value={draft.apiEndpoint} onChange={(e) => update({ apiEndpoint: e.target.value })} placeholder="https://chroma.yourdomain.com" />
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

              {/* Login / Authentication */}
              {authStatus.authenticated ? (
                <SettingsField label="Authentication" hint="You are logged in to the V3 API">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#16A34A] bg-[#ECFDF3] border border-[#BBF7D0] px-2.5 py-1" style={{ borderRadius: 2 }}>
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><circle cx="5" cy="5" r="5" fill="#16A34A"/><path d="M3 5l1.5 1.5 2.5-3" stroke="white" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        Authenticated
                      </span>
                      <span className="text-[12px] text-[#374151]">{authStatus.email}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => void onLogout()} className="px-3 py-1.5 text-[11px] font-medium border border-[#FECACA] bg-[#FEF2F2] text-[#DC2626] hover:bg-[#FEE2E2] transition-colors" style={{ borderRadius: 2 }}>
                        Log Out
                      </button>
                    </div>
                  </div>
                </SettingsField>
              ) : (
                <SettingsField label="Login" hint="Enter your V3 / ChromaFlow credentials to authenticate">
                  <div className="flex flex-col gap-2 max-w-[320px]">
                    <input
                      type="email"
                      className={inp}
                      style={{ borderRadius: 2 }}
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="Email address"
                      onKeyDown={(e) => { if (e.key === "Enter" && loginEmail && loginPassword) void onLogin(); }}
                    />
                    <input
                      type="password"
                      className={inp}
                      style={{ borderRadius: 2 }}
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="Password"
                      onKeyDown={(e) => { if (e.key === "Enter" && loginEmail && loginPassword) void onLogin(); }}
                    />
                    {loginError && (
                      <span className="text-[11px] text-[#DC2626] font-medium">{loginError}</span>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Toggle checked={draft.stayLoggedIn} onChange={(v) => update({ stayLoggedIn: v })} />
                      <span className="text-[11px] text-[#374151]">Stay logged in (persist token across restarts)</span>
                    </label>
                    <button
                      onClick={() => void onLogin()}
                      disabled={!loginEmail || !loginPassword || loggingIn}
                      className="px-4 py-1.5 text-[11px] font-semibold bg-[#2563EB] hover:bg-[#1D4ED8] text-white transition-colors disabled:opacity-50 w-fit"
                      style={{ borderRadius: 2 }}
                    >
                      {loggingIn ? "Logging in…" : "Log In"}
                    </button>
                  </div>
                </SettingsField>
              )}

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
              <SettingsField label="Concurrent uploads" hint="Maximum number of files uploading at the same time">
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={10} value={draft.maxConcurrentUploads} onChange={(e) => update({ maxConcurrentUploads: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} className={cn(inp, "w-20")} style={{ borderRadius: 2 }} />
                  <span className="text-[11px] text-[#6B7280]">max parallel</span>
                </div>
              </SettingsField>
              <SettingsField label="Auto-start watching" hint="Start watching configured directories on launch">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={draft.autoStart} onChange={(v) => update({ autoStart: v })} />
                  <span className="text-[11px] text-[#374151]">Start watching on app launch</span>
                </label>
              </SettingsField>
              <SettingsField label="Upload metadata" hint="Choose when to assign method/column/batch to each file">
                <select
                  value={draft.uploadAssignmentMode}
                  onChange={(e) => update({ uploadAssignmentMode: e.target.value as AppSettings["uploadAssignmentMode"] })}
                  className="px-2 py-1.5 text-[12px] bg-white border border-[#D1D5DB] text-[#111827] outline-none focus:border-[#2563EB] w-40"
                  style={{ borderRadius: 2 }}
                >
                  <option value="per-folder">Per watch folder</option>
                  <option value="per-file">Per individual upload</option>
                </select>
              </SettingsField>
              <SettingsField label="History deletion" hint="What happens when a row is removed from Upload History">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Toggle checked={draft.forgetProcessedOnDelete} onChange={(v) => update({ forgetProcessedOnDelete: v })} />
                  <span className="text-[11px] text-[#374151]">Forget processed marker when deleting history</span>
                </label>
              </SettingsField>
              <SettingsField label="Reset statistics" hint="Clear the dashboard counters and upload history">
                <ResetStatsButton />
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
          <button onClick={() => setDraft({ ...DEFAULT_SETTINGS })} className="text-[11px] text-[#9CA3AF] hover:text-[#6B7280] transition-colors">Reset to defaults</button>
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

function ResetStatsButton() {
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);

  const onClick = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    try {
      await window.desktop?.resetStats();
      setDone(true);
      setConfirming(false);
      setTimeout(() => setDone(false), 3000);
    } catch {
      setConfirming(false);
    }
  };

  return (
    <button
      onClick={() => void onClick()}
      className={cn(
        "px-3 py-1.5 text-[11px] font-medium border transition-colors",
        done
          ? "border-[#BBF7D0] bg-[#ECFDF3] text-[#16A34A]"
          : confirming
            ? "border-[#FECACA] bg-[#FEE2E2] text-[#DC2626] hover:bg-[#FECACA]"
            : "border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F3F4F6]",
      )}
      style={{ borderRadius: 2 }}
    >
      {done ? "✓ Statistics reset" : confirming ? "Click again to confirm" : "Reset dashboard stats"}
    </button>
  );
}
