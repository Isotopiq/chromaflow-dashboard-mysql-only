// Shared IPC types — used by both the main process and the renderer.
// This file is imported by both sides, so it must not import any Node or
// browser-specific APIs.

export type View = "dashboard" | "queue" | "directories" | "history" | "settings";
export type WatcherStatus = "idle" | "watching" | "paused" | "error";
export type UploadStatus = "queued" | "parsing" | "uploading" | "done" | "failed" | "cancelled";
export type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

export type QueueItem = {
  id: string;
  filename: string;
  filePath: string;
  folderId: string;
  size: number;
  status: UploadStatus;
  progress: number;
  error: string | null;
  createdAt: number;
  retries: number;
};

export type WatchFolder = {
  id: string;
  path: string;
  enabled: boolean;
  methodId: string | null;
  columnId: string | null;
  batchId: string | null;
  filePattern: string;
  // Desktop-specific local settings
  recursive: boolean;
  stabilizeSeconds: number;
  archiveBehavior: "leave" | "move" | "delete";
  archivePath: string | null;
  maxRetries: number;
};

export type HistoryEntry = {
  id: number;
  filename: string;
  sourceDir: string;
  uploadedAt: number;
  size: number;
  durationMs: number;
  status: UploadStatus;
  sha256: string;
  runId: string | null;
  v3FolderId: string | null;
};

export type LogEntry = {
  id: number;
  timestamp: number;
  level: LogLevel;
  message: string;
};

export type DashboardStats = {
  filesDetected: number;
  uploadsSucceeded: number;
  uploadsFailed: number;
  queueDepth: number;
  watcherStatus: WatcherStatus;
};

export type HourlyUpload = { h: string; v: number };

export type AppSettings = {
  apiEndpoint: string;
  token: string | null;
  userEmail: string | null;
  maxConcurrentUploads: number;
  defaultStabilizeSeconds: number;
  defaultMaxRetries: number;
  notifications: boolean;
  logLevel: LogLevel;
  minimizeToTray: boolean;
  autoStart: boolean;
  stayLoggedIn: boolean;
};

export type LabData = {
  methods: Array<{ id: string; name: string }>;
  columns: Array<{ id: string; name: string }>;
  batches: Array<{ id: string; name: string }>;
  compoundLists: Array<{ id: string; name: string }>;
};

export type AuthStatus = {
  authenticated: boolean;
  email: string | null;
};

// IPC channel names
export const IPC = {
  // Events (main → renderer)
  ON_QUEUE_UPDATE: "queue:update",
  ON_LOG_ENTRY: "log:entry",
  ON_WATCHER_STATUS: "watcher:status",
  ON_UPLOAD_PROGRESS: "upload:progress",
  ON_TOAST: "toast",

  // Commands (renderer → main)
  GET_QUEUE: "queue:get",
  CANCEL_UPLOAD: "queue:cancel",
  RETRY_UPLOAD: "queue:retry",
  REMOVE_QUEUE_ITEM: "queue:remove",
  CLEAR_QUEUE: "queue:clear",
  PAUSE_ALL: "watcher:pause-all",
  RESUME_ALL: "watcher:resume-all",

  GET_WATCH_FOLDERS: "folders:get",
  ADD_WATCH_FOLDER: "folders:add",
  UPDATE_WATCH_FOLDER: "folders:update",
  REMOVE_WATCH_FOLDER: "folders:remove",
  PICK_DIRECTORY: "folders:pick-directory",

  GET_HISTORY: "history:get",
  EXPORT_HISTORY_CSV: "history:export-csv",
  SAVE_HISTORY_CSV: "history:save-csv",
  CLEAR_HISTORY: "history:clear",

  GET_SETTINGS: "settings:get",
  SAVE_SETTINGS: "settings:save",
  TEST_CONNECTION: "settings:test-connection",

  LOGIN: "auth:login",
  LOGOUT: "auth:logout",
  GET_AUTH_STATUS: "auth:status",

  GET_DASHBOARD_STATS: "dashboard:stats",
  GET_HOURLY_UPLOADS: "dashboard:hourly",

  GET_LAB_DATA: "lab:data",

  SHOW_WINDOW: "window:show",
  QUIT_APP: "app:quit",
  MINIMIZE: "window:minimize",
  MAXIMIZE: "window:maximize",
  CLOSE: "window:close",
} as const;
