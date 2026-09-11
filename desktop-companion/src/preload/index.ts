// Preload script — exposes a safe, limited API to the renderer via contextBridge.
// The renderer accesses these via `window.desktop.*`.
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-types";

const api = {
  // ---- Window controls ----
  minimize: () => ipcRenderer.invoke(IPC.MINIMIZE),
  maximize: () => ipcRenderer.invoke(IPC.MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC.CLOSE),
  quitApp: () => ipcRenderer.invoke(IPC.QUIT_APP),

  // ---- Queue ----
  getQueue: () => ipcRenderer.invoke(IPC.GET_QUEUE),
  cancelUpload: (id: string) => ipcRenderer.invoke(IPC.CANCEL_UPLOAD, id),
  retryUpload: (id: string) => ipcRenderer.invoke(IPC.RETRY_UPLOAD, id),
  removeQueueItem: (id: string) => ipcRenderer.invoke(IPC.REMOVE_QUEUE_ITEM, id),
  clearQueue: (mode: string) => ipcRenderer.invoke(IPC.CLEAR_QUEUE, mode),
  assignQueueMetadata: (id: string, metadata: any) => ipcRenderer.invoke(IPC.ASSIGN_QUEUE_METADATA, id, metadata),
  pauseAll: () => ipcRenderer.invoke(IPC.PAUSE_ALL),
  resumeAll: () => ipcRenderer.invoke(IPC.RESUME_ALL),
  getWatcherStatus: () => ipcRenderer.invoke(IPC.GET_WATCHER_STATUS),

  // ---- Watch folders ----
  getWatchFolders: () => ipcRenderer.invoke(IPC.GET_WATCH_FOLDERS),
  addWatchFolder: (folder: any) => ipcRenderer.invoke(IPC.ADD_WATCH_FOLDER, folder),
  updateWatchFolder: (folder: any) => ipcRenderer.invoke(IPC.UPDATE_WATCH_FOLDER, folder),
  removeWatchFolder: (id: string) => ipcRenderer.invoke(IPC.REMOVE_WATCH_FOLDER, id),
  pickDirectory: () => ipcRenderer.invoke(IPC.PICK_DIRECTORY),

  // ---- History ----
  getHistory: (page: number, pageSize: number) =>
    ipcRenderer.invoke(IPC.GET_HISTORY, page, pageSize),
  deleteHistoryItems: (ids: number[]) => ipcRenderer.invoke(IPC.DELETE_HISTORY_ITEMS, ids),
  reuploadHistoryItem: (id: number) => ipcRenderer.invoke(IPC.REUPLOAD_HISTORY_ITEM, id),
  exportHistoryCsv: () => ipcRenderer.invoke(IPC.EXPORT_HISTORY_CSV),
  saveHistoryCsv: () => ipcRenderer.invoke(IPC.SAVE_HISTORY_CSV),
  clearHistory: () => ipcRenderer.invoke(IPC.CLEAR_HISTORY),

  // ---- Settings ----
  getSettings: () => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (settings: any) => ipcRenderer.invoke(IPC.SAVE_SETTINGS, settings),
  testConnection: () => ipcRenderer.invoke(IPC.TEST_CONNECTION),

  // ---- Auth ----
  login: (email: string, password: string) =>
    ipcRenderer.invoke(IPC.LOGIN, email, password),
  logout: () => ipcRenderer.invoke(IPC.LOGOUT),
  getAuthStatus: () => ipcRenderer.invoke(IPC.GET_AUTH_STATUS),

  // ---- Dashboard ----
  getDashboardStats: () => ipcRenderer.invoke(IPC.GET_DASHBOARD_STATS),
  getHourlyUploads: () => ipcRenderer.invoke(IPC.GET_HOURLY_UPLOADS),
  resetStats: () => ipcRenderer.invoke(IPC.RESET_STATS),

  // ---- Lab Data ----
  getLabData: () => ipcRenderer.invoke(IPC.GET_LAB_DATA),

  // ---- Logs ----
  getLogs: (limit?: number, level?: string) => ipcRenderer.invoke(IPC.GET_LOGS, limit, level),

  // ---- Event listeners (main → renderer) ----
  onQueueUpdate: (callback: (items: any[]) => void) => {
    const handler = (_: any, items: any[]) => callback(items);
    ipcRenderer.on(IPC.ON_QUEUE_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC.ON_QUEUE_UPDATE, handler);
  },
  onQueueNeedsConfig: (callback: (item: any) => void) => {
    const handler = (_: any, item: any) => callback(item);
    ipcRenderer.on(IPC.ON_QUEUE_NEEDS_CONFIG, handler);
    return () => ipcRenderer.removeListener(IPC.ON_QUEUE_NEEDS_CONFIG, handler);
  },
  onLogEntry: (callback: (entry: any) => void) => {
    const handler = (_: any, entry: any) => callback(entry);
    ipcRenderer.on(IPC.ON_LOG_ENTRY, handler);
    return () => ipcRenderer.removeListener(IPC.ON_LOG_ENTRY, handler);
  },
  onWatcherStatus: (callback: (status: any) => void) => {
    const handler = (_: any, status: any) => callback(status);
    ipcRenderer.on(IPC.ON_WATCHER_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.ON_WATCHER_STATUS, handler);
  },
  onUploadProgress: (callback: (item: any) => void) => {
    const handler = (_: any, item: any) => callback(item);
    ipcRenderer.on(IPC.ON_UPLOAD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.ON_UPLOAD_PROGRESS, handler);
  },
  onToast: (callback: (toast: any) => void) => {
    const handler = (_: any, toast: any) => callback(toast);
    ipcRenderer.on(IPC.ON_TOAST, handler);
    return () => ipcRenderer.removeListener(IPC.ON_TOAST, handler);
  },

  // ---- Navigation (from tray) ----
  onNavigate: (callback: (view: string) => void) => {
    const handler = (_: any, view: string) => callback(view);
    ipcRenderer.on("navigate", handler);
    return () => ipcRenderer.removeListener("navigate", handler);
  },
};

contextBridge.exposeInMainWorld("desktop", api);
