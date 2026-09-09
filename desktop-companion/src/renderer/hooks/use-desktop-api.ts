// React hook for accessing the desktop IPC API.
// Falls back to empty/default values when running in browser dev mode
// (window.desktop is undefined outside Electron).
import { useEffect, useState, useCallback } from "react";
import type {
  QueueItem,
  WatchFolder,
  HistoryEntry,
  DashboardStats,
  HourlyUpload,
  AppSettings,
  LabData,
  AuthStatus,
  WatcherStatus,
  LogEntry,
} from "@shared/ipc-types";

// Safe wrapper — returns null if window.desktop is not available
function getDesktop() {
  return typeof window !== "undefined" ? window.desktop : undefined;
}

export function useDesktopApi() {
  return getDesktop();
}

// ---- Queue hook ----
export function useQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    desktop.getQueue().then(setItems).catch(() => {});
    const off1 = desktop.onQueueUpdate((updated) => setItems(updated));
    const off2 = desktop.onUploadProgress((item) => {
      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, progress: item.progress, status: item.status } : it));
    });
    return () => { off1?.(); off2?.(); };
  }, [desktop]);

  const cancel = useCallback((id: string) => desktop?.cancelUpload(id), [desktop]);
  const retry = useCallback((id: string) => desktop?.retryUpload(id), [desktop]);
  const remove = useCallback((id: string) => desktop?.removeQueueItem(id), [desktop]);
  const clearQueue = useCallback((mode: string) => desktop?.clearQueue(mode), [desktop]);

  return { items, cancel, retry, remove, clearQueue };
}

// ---- Watch folders hook ----
export function useWatchFolders() {
  const [folders, setFolders] = useState<WatchFolder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const desktop = getDesktop();

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      const result = await desktop.getWatchFolders();
      setFolders(result);
      setError(null);
    } catch (e: any) {
      setFolders([]);
      setError(e?.message ?? "Failed to load watch folders");
    }
  }, [desktop]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(async (folder: Partial<WatchFolder>) => {
    if (!desktop) return;
    try {
      setError(null);
      await desktop.addWatchFolder(folder);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to add watch folder");
    }
  }, [desktop, refresh]);

  const update = useCallback(async (folder: WatchFolder) => {
    if (!desktop) return;
    try {
      setError(null);
      await desktop.updateWatchFolder(folder);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to update watch folder");
    }
  }, [desktop, refresh]);

  const remove = useCallback(async (id: string) => {
    if (!desktop) return;
    try {
      setError(null);
      await desktop.removeWatchFolder(id);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove watch folder");
    }
  }, [desktop, refresh]);

  const pickDirectory = useCallback(() => desktop?.pickDirectory() ?? Promise.resolve(null), [desktop]);

  return { folders, add, update, remove, pickDirectory, refresh, error };
}

// ---- History hook ----
export function useHistory(page: number, pageSize: number) {
  const [data, setData] = useState<{ entries: HistoryEntry[]; total: number }>({ entries: [], total: 0 });
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    desktop.getHistory(page, pageSize).then(setData).catch(() => {});
  }, [desktop, page, pageSize]);

  return data;
}

// ---- Settings hook ----
export function useSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    desktop.getSettings().then(setSettings).catch(() => {});
  }, [desktop]);

  const save = useCallback(async (partial: Partial<AppSettings>) => {
    if (!desktop) return;
    await desktop.saveSettings(partial);
    const updated = await desktop.getSettings();
    setSettings(updated);
  }, [desktop]);

  const testConnection = useCallback(async () => {
    if (!desktop) return { ok: false, latencyMs: 0 };
    return desktop.testConnection();
  }, [desktop]);

  return { settings, save, testConnection };
}

// ---- Dashboard hook ----
export function useDashboardStats() {
  const [stats, setStats] = useState<DashboardStats & { watcherStatus: WatcherStatus }>({
    filesDetected: 0,
    uploadsSucceeded: 0,
    uploadsFailed: 0,
    queueDepth: 0,
    watcherStatus: "idle",
  });
  const [hourly, setHourly] = useState<HourlyUpload[]>([]);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    const refresh = () => {
      desktop.getDashboardStats().then(setStats).catch(() => {});
      desktop.getHourlyUploads().then(setHourly).catch(() => {});
    };
    refresh();
    const off = desktop.onWatcherStatus(() => refresh());
    const interval = setInterval(refresh, 5000);
    return () => { off?.(); clearInterval(interval); };
  }, [desktop]);

  return { stats, hourly };
}

// ---- Auth hook ----
export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>({ authenticated: false, email: null });
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    desktop.getAuthStatus().then(setStatus).catch(() => {});
  }, [desktop]);

  const login = useCallback(async (email: string, password: string) => {
    if (!desktop) throw new Error("Desktop API not available");
    const result = await desktop.login(email, password);
    setStatus({ authenticated: true, email: result.user.email });
    return result;
  }, [desktop]);

  const logout = useCallback(async () => {
    if (!desktop) return;
    await desktop.logout();
    setStatus({ authenticated: false, email: null });
  }, [desktop]);

  return { status, login, logout };
}

// ---- Lab data hook ----
export function useLabData() {
  const [data, setData] = useState<LabData>({ methods: [], columns: [], batches: [], compoundLists: [] });
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    desktop.getLabData().then(setData).catch(() => {});
  }, [desktop]);

  return data;
}

// ---- Logs hook ----
export function useLogs(maxEntries = 200) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onLogEntry((entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, maxEntries));
    });
    return () => off?.();
  }, [desktop, maxEntries]);

  return logs;
}

// ---- Toast hook ----
export function useToasts() {
  const [toasts, setToasts] = useState<{ type: string; message: string; id: number }[]>([]);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onToast((toast) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { ...toast, id }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    });
    return () => off?.();
  }, [desktop]);

  return toasts;
}
