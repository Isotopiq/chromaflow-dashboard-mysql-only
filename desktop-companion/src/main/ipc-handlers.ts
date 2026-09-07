// IPC handlers — bridges the renderer and the main process services.
import { BrowserWindow, dialog, IpcMain } from "electron";
import type { LocalDb } from "./db";
import type { ConfigManager } from "./config";
import type { ApiClient } from "./api-client";
import type { WatcherManager } from "./watcher";
import type { UploadQueue } from "./upload-queue";
import type { TrayManager } from "./tray";
import { IPC } from "../shared/ipc-types";

export class IpcHandlers {
  constructor(
    private db: LocalDb,
    private config: ConfigManager,
    private api: ApiClient,
    private watcher: WatcherManager,
    private queue: UploadQueue,
    private tray: TrayManager,
    private window: BrowserWindow | null,
  ) {}

  registerAll(ipcMain: IpcMain) {
    // ---- Window controls ----
    ipcMain.handle(IPC.MINIMIZE, () => this.window?.minimize());
    ipcMain.handle(IPC.MAXIMIZE, () => {
      if (this.window?.isMaximized()) this.window?.unmaximize();
      else this.window?.maximize();
    });
    ipcMain.handle(IPC.CLOSE, () => this.window?.close());
    ipcMain.handle(IPC.SHOW_WINDOW, () => {
      this.window?.show();
      this.window?.focus();
    });
    ipcMain.handle(IPC.QUIT_APP, () => {
      (require("electron").app as any).isQuitting = true;
      require("electron").app.quit();
    });

    // ---- Queue ----
    ipcMain.handle(IPC.GET_QUEUE, () => this.queue.getQueue());
    ipcMain.handle(IPC.CANCEL_UPLOAD, (_, id: string) => this.queue.cancel(id));
    ipcMain.handle(IPC.RETRY_UPLOAD, (_, id: string) => this.queue.retry(id));
    ipcMain.handle(IPC.PAUSE_ALL, () => {
      this.watcher.pauseAll();
      this.tray.togglePauseLabel(true);
    });
    ipcMain.handle(IPC.RESUME_ALL, () => {
      this.watcher.resumeAll();
      this.tray.togglePauseLabel(false);
    });

    // ---- Watch folders ----
    ipcMain.handle(IPC.GET_WATCH_FOLDERS, async () => {
      try {
        return await this.api.listWatchFolders();
      } catch {
        return [];
      }
    });
    ipcMain.handle(IPC.ADD_WATCH_FOLDER, async (_, folder: any) => {
      const created = await this.api.upsertWatchFolder(folder);
      // Start watching if enabled
      if (created.enabled) {
        this.watcher.startWatching(created);
      }
      return created;
    });
    ipcMain.handle(IPC.UPDATE_WATCH_FOLDER, async (_, folder: any) => {
      const updated = await this.api.upsertWatchFolder(folder);
      this.watcher.stopWatching(updated.id);
      if (updated.enabled) {
        this.watcher.startWatching(updated);
      }
      return updated;
    });
    ipcMain.handle(IPC.REMOVE_WATCH_FOLDER, async (_, id: string) => {
      this.watcher.stopWatching(id);
      return this.api.deleteWatchFolder(id);
    });
    ipcMain.handle(IPC.PICK_DIRECTORY, async () => {
      const result = await dialog.showOpenDialog(this.window!, {
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    });

    // ---- History ----
    ipcMain.handle(IPC.GET_HISTORY, (_, page: number, pageSize: number) => {
      return this.db.getHistory(page, pageSize);
    });
    ipcMain.handle(IPC.EXPORT_HISTORY_CSV, () => {
      const { entries } = this.db.getHistory(0, 100000);
      const csv = [
        "filename,source_dir,uploaded_at,size,duration_ms,status,sha256,run_id",
        ...entries.map((e: any) =>
          `${e.filename},${e.sourceDir},${new Date(e.uploadedAt).toISOString()},${e.size},${e.durationMs},${e.status},${e.sha256 ?? ""},${e.runId ?? ""}`,
        ),
      ].join("\n");
      return csv;
    });
    ipcMain.handle(IPC.CLEAR_HISTORY, () => this.db.clearHistory());

    // ---- Settings ----
    ipcMain.handle(IPC.GET_SETTINGS, () => this.config.getAll());
    ipcMain.handle(IPC.SAVE_SETTINGS, (_, settings: any) => {
      const updated = this.config.update(settings);
      return updated;
    });
    ipcMain.handle(IPC.TEST_CONNECTION, async () => {
      return this.api.testConnection();
    });

    // ---- Auth ----
    ipcMain.handle(IPC.LOGIN, async (_, email: string, password: string) => {
      return this.api.login(email, password);
    });
    ipcMain.handle(IPC.LOGOUT, () => {
      this.api.logout();
    });
    ipcMain.handle(IPC.GET_AUTH_STATUS, () => ({
      authenticated: this.api.isAuthenticated(),
      email: this.config.get("userEmail"),
    }));

    // ---- Dashboard ----
    ipcMain.handle(IPC.GET_DASHBOARD_STATS, () => {
      const stats = this.db.getDashboardStats();
      return { ...stats, watcherStatus: this.watcher.getStatus() };
    });
    ipcMain.handle(IPC.GET_HOURLY_UPLOADS, () => {
      return this.db.getHourlyUploads();
    });

    // ---- Lab Data ----
    ipcMain.handle(IPC.GET_LAB_DATA, async () => {
      try {
        return await this.api.getLabData();
      } catch {
        return { methods: [], columns: [], batches: [], compoundLists: [] };
      }
    });
  }
}
