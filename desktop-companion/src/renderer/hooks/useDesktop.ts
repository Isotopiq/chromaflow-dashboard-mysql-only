// Re-export from use-desktop-api, plus additional hooks needed by the
// subagent-generated views.
export * from "./use-desktop-api";

import { useState, useEffect, useCallback } from "react";
import type { WatcherStatus, LogEntry } from "@shared/ipc-types";

function getDesktop() {
  return typeof window !== "undefined" ? window.desktop : undefined;
}

// Window controls hook
export function useWindowControls() {
  const desktop = getDesktop();
  return {
    minimize: () => desktop?.minimize(),
    maximize: () => desktop?.maximize(),
    close: () => desktop?.close(),
  };
}

// Pause/Resume All hook
export function usePauseAll() {
  const [paused, setPaused] = useState(false);
  const desktop = getDesktop();

  const toggle = useCallback(() => {
    if (paused) {
      desktop?.resumeAll();
      setPaused(false);
    } else {
      desktop?.pauseAll();
      setPaused(true);
    }
  }, [paused, desktop]);

  return { paused, toggle };
}

// Watcher status hook
export function useWatcherStatus(): WatcherStatus {
  const [status, setStatus] = useState<WatcherStatus>("watching");
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onWatcherStatus((s) => setStatus(s));
    return () => off?.();
  }, [desktop]);

  return status;
}

// Log entries hook — returns { entries, clear } for compatibility with views
export function useLogEntries(maxEntries = 200): { entries: LogEntry[]; clear: () => void } {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    const off = desktop.onLogEntry((entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, maxEntries));
    });
    return () => off?.();
  }, [desktop, maxEntries]);

  const clear = useCallback(() => setLogs([]), []);

  return { entries: logs, clear };
}

// Hourly uploads hook
export function useHourlyUploads() {
  const [data, setData] = useState<{ h: string; v: number }[]>([]);
  const desktop = getDesktop();

  useEffect(() => {
    if (!desktop) return;
    desktop.getHourlyUploads().then(setData).catch(() => {});
    const interval = setInterval(() => {
      desktop.getHourlyUploads().then(setData).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [desktop]);

  return data;
}
