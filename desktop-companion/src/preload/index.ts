// Preload script — exposes a safe, limited API to the renderer via contextBridge.
// The renderer accesses these via `window.desktop.*`.
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "@shared/ipc-types";

const api = {
  // ---- Window controls ----
  minimize: () => ipcRenderer.invoke(IPC.MINIMIZE),
  maximize: () => ipcRenderer.invoke(IPC.MAXIMIZE),
  close: () => ipcRenderer.invoke(IPC.CLOSE),

  // ---- Queue ----
  getQueue: () => ipcRenderer.invoke(IPC.GET_QUEUE),
  cancelUpload: (id: string) => ipcRenderer.invoke(IPC.CANCEL_UPLOAD, id),
  retryUpload: (id: string) => ipcRenderer.invoke(IPC.RETRY_UPLOAD, id),
  pauseAll: () => ipcRenderer.invoke(IPC.PAUSE_ALL),
  resumeAll: () => ipcRenderer.invoke(IPC.RESUME_ALL),

  // ---- Watch folders ----
  getWatchFolders: () => ipcRenderer.invoke(IPC.GET_WATCH_FOLDERS),
  addWatchFolder: (folder: any) => ipcRenderer.invoke(IPC.ADD_WATCH_FOLDER, folder),
  updateWatchFolder: (folder: any) => ipcRenderer.invoke(IPC.UPDATE_WATCH_FOLDER, folder),
  removeWatchFolder: (id: string) => ipcRenderer.invoke(IPC.REMOVE_WATCH_FOLDER, id),
  pickDirectory: () => ipcRenderer.invoke(IPC.PICK_DIRECTORY),

  // ---- History ----
  getHistory: (page: number, pageSize: number) =>
    ipcRenderer.invoke(IPC.GET_HISTORY, page, pageSize),
  exportHistoryCsv: () => ipcRenderer.invoke(IPC.EXPORT_HISTORY_CSV),
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

  // ---- Lab Data ----
  getLabData: () => ipcRenderer.invoke(IPC.GET_LAB_DATA),

  // ---- Event listeners (main → renderer) ----
  onQueueUpdate: (callback: (items: any[]) => void) =>
    ipcRenderer.on(IPC.ON_QUEUE_UPDATE, (_, items) => callback(items)),
  onLogEntry: (callback: (entry: any) => void) =>
    ipcRenderer.on(IPC.ON_LOG_ENTRY, (_, entry) => callback(entry)),
  onWatcherStatus: (callback: (status: any) => void) =>
    ipcRenderer.on(IPC.ON_WATCHER_STATUS, (_, status) => callback(status)),
  onUploadProgress: (callback: (item: any) => void) =>
    ipcRenderer.on(IPC.ON_UPLOAD_PROGRESS, (_, item) => callback(item)),
  onToast: (callback: (toast: any) => void) =>
    ipcRenderer.on(IPC.ON_TOAST, (_, toast) => callback(toast)),

  // ---- Navigation (from tray) ----
  onNavigate: (callback: (view: string) => void) =>
    ipcRenderer.on("navigate", (_, view) => callback(view)),
};

contextBridge.exposeInMainWorld("desktop", api);
