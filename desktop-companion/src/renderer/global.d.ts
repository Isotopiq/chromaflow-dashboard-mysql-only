// Type declarations for the window.desktop API exposed by the preload script.
import type {
  QueueItem,
  WatchFolder,
  HistoryEntry,
  LogEntry,
  DashboardStats,
  HourlyUpload,
  AppSettings,
  LabData,
  AuthStatus,
  WatcherStatus,
} from "@shared/ipc-types";

export interface DesktopApi {
  // Window controls
  minimize: () => Promise<void>;
  maximize: () => Promise<void>;
  close: () => Promise<void>;
  quitApp: () => Promise<void>;

  // Queue
  getQueue: () => Promise<QueueItem[]>;
  cancelUpload: (id: string) => Promise<void>;
  retryUpload: (id: string) => Promise<void>;
  removeQueueItem: (id: string) => Promise<void>;
  clearQueue: (mode: string) => Promise<void>;
  pauseAll: () => Promise<void>;
  resumeAll: () => Promise<void>;

  // Watch folders
  getWatchFolders: () => Promise<WatchFolder[]>;
  addWatchFolder: (folder: Partial<WatchFolder>) => Promise<WatchFolder>;
  updateWatchFolder: (folder: WatchFolder) => Promise<void>;
  removeWatchFolder: (id: string) => Promise<void>;
  pickDirectory: () => Promise<string | null>;

  // History
  getHistory: (page: number, pageSize: number) => Promise<{ entries: HistoryEntry[]; total: number }>;
  exportHistoryCsv: () => Promise<string>;
  saveHistoryCsv: () => Promise<string | null>;
  clearHistory: () => Promise<void>;

  // Settings
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<void>;
  testConnection: () => Promise<{ ok: boolean; latencyMs: number }>;

  // Auth
  login: (email: string, password: string) => Promise<{ token: string; user: { id: string; email: string } }>;
  logout: () => Promise<void>;
  getAuthStatus: () => Promise<AuthStatus>;

  // Dashboard
  getDashboardStats: () => Promise<DashboardStats & { watcherStatus: WatcherStatus }>;
  getHourlyUploads: () => Promise<HourlyUpload[]>;

  // Lab Data
  getLabData: () => Promise<LabData>;

  // Event listeners
  onQueueUpdate: (callback: (items: QueueItem[]) => void) => () => void;
  onLogEntry: (callback: (entry: LogEntry) => void) => () => void;
  onWatcherStatus: (callback: (status: WatcherStatus) => void) => () => void;
  onUploadProgress: (callback: (item: QueueItem) => void) => () => void;
  onToast: (callback: (toast: { type: string; message: string }) => void) => () => void;
  onNavigate: (callback: (view: string) => void) => () => void;
}

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

export {};
