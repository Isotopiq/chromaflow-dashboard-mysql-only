// IPC handlers — bridges the renderer and the main process services.
import { BrowserWindow, dialog, IpcMain } from "electron";
import crypto from "node:crypto";
import type { LocalDb } from "./db";
import type { ConfigManager } from "./config";
import type { ApiClient } from "./api-client";
import type { WatcherManager } from "./watcher";
import type { UploadQueue } from "./upload-queue";
import type { TrayManager } from "./tray";
import type { WatchFolder } from "../shared/ipc-types";
import { IPC } from "../shared/ipc-types";
import { setQuitting } from "./index";

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

  setWindow(window: BrowserWindow) {
    this.window = window;
  }

  registerDataHandlers(ipcMain: IpcMain) {
    // ---- Queue ----
    ipcMain.handle(IPC.GET_QUEUE, () => this.queue.getQueue());
    ipcMain.handle(IPC.CANCEL_UPLOAD, (_, id: string) => this.queue.cancel(id));
    ipcMain.handle(IPC.RETRY_UPLOAD, (_, id: string) => this.queue.retry(id));
    ipcMain.handle(IPC.REMOVE_QUEUE_ITEM, (_, id: string) => this.queue.remove(id));
    ipcMain.handle(IPC.CLEAR_QUEUE, (_, mode: string) => {
      if (mode === "completed") this.queue.clearCompleted();
      else if (mode === "failed") this.queue.clearFailed();
      else this.queue.clearAll();
    });
    ipcMain.handle(IPC.GET_WATCHER_STATUS, () => this.watcher.getStatus());
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
      // Try API first, fall back to local
      try {
        const apiFolders = await this.api.listWatchFolders();
        if (apiFolders.length > 0) return apiFolders;
      } catch {
        // API not available — use local
      }
      return this.db.getLocalWatchFolders();
    });
    ipcMain.handle(IPC.ADD_WATCH_FOLDER, async (_, folder: any) => {
      const id = folder.id ?? crypto.randomUUID();
      const localFolder: WatchFolder = {
        id,
        path: folder.path,
        enabled: folder.enabled ?? true,
        recursive: folder.recursive ?? true,
        stabilizeSeconds: folder.stabilizeSeconds ?? 30,
        filePattern: folder.filePattern ?? "*.mzXML",
        methodId: folder.methodId ?? null,
        columnId: folder.columnId ?? null,
        batchId: folder.batchId ?? null,
        archiveBehavior: folder.archiveBehavior ?? "leave",
        archivePath: folder.archivePath ?? null,
        maxRetries: folder.maxRetries ?? 0,
      };

      // Save locally first (always)
      this.db.addLocalWatchFolder(localFolder);

      // Try to sync to API
      try {
        const created = await this.api.upsertWatchFolder(folder);
        // Start watching with the API-returned folder (has server ID)
        if (created.enabled) {
          this.watcher.startWatching(created);
        }
        return created;
      } catch {
        // API not available — use local folder
        this.db.log("WARN", `Could not sync watch folder to V3 API, using local only: ${localFolder.path}`);
        if (localFolder.enabled) {
          this.watcher.startWatching(localFolder);
        }
        return localFolder;
      }
    });
    ipcMain.handle(IPC.UPDATE_WATCH_FOLDER, async (_, folder: any) => {
      // Update locally first
      this.db.updateLocalWatchFolder(folder.id, {
        enabled: folder.enabled,
        recursive: folder.recursive,
        stabilizeSeconds: folder.stabilizeSeconds,
        filePattern: folder.filePattern,
        methodId: folder.methodId,
        columnId: folder.columnId,
        batchId: folder.batchId,
      });

      this.watcher.stopWatching(folder.id);

      // Try to sync to API
      try {
        const updated = await this.api.upsertWatchFolder(folder);
        if (updated.enabled) {
          this.watcher.startWatching(updated);
        }
        return updated;
      } catch {
        // API not available — use local folder
        const localFolder = this.db.getLocalWatchFolders().find((f) => f.id === folder.id);
        if (localFolder?.enabled) {
          this.watcher.startWatching(localFolder);
        }
        return localFolder ?? folder;
      }
    });
    ipcMain.handle(IPC.REMOVE_WATCH_FOLDER, async (_, id: string) => {
      this.watcher.stopWatching(id);
      this.db.removeLocalWatchFolder(id);
      try {
        return await this.api.deleteWatchFolder(id);
      } catch {
        return { ok: true };
      }
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
    ipcMain.handle(IPC.RESET_STATS, () => {
      this.db.resetStats();
      return this.db.getDashboardStats();
    });

    // ---- Lab Data ----
    ipcMain.handle(IPC.GET_LAB_DATA, async () => {
      try {
        return await this.api.getLabData();
      } catch {
        return { methods: [], columns: [], batches: [], compoundLists: [] };
      }
    });

    // ---- Logs ----
    ipcMain.handle(IPC.GET_LOGS, (_, limit?: number, level?: string) => {
      return this.db.getLogs(limit ?? 200, level as any);
    });
    ipcMain.handle("logs:clear", () => this.db.clearLogs());
  }

  registerWindowHandlers(ipcMain: IpcMain) {
    // ---- Window controls ----
    ipcMain.handle(IPC.MINIMIZE, () => this.window?.minimize());
    ipcMain.handle(IPC.MAXIMIZE, () => {
      if (this.window?.isMaximized()) this.window?.unmaximize();
      else this.window?.maximize();
    });
    ipcMain.handle(IPC.CLOSE, () => {
      // Check if user has minimize-to-tray enabled
      const minimizeToTray = this.config.get("minimizeToTray");
      if (minimizeToTray) {
        // Hide to tray instead of quitting
        this.window?.hide();
      } else {
        // Actually quit the app
        setQuitting(true);
        require("electron").app.quit();
      }
    });
    ipcMain.handle(IPC.SHOW_WINDOW, () => {
      this.window?.show();
      this.window?.focus();
    });
    ipcMain.handle(IPC.QUIT_APP, () => {
      setQuitting(true);
      require("electron").app.quit();
    });

    // ---- Dialogs ----
    ipcMain.handle(IPC.PICK_DIRECTORY, async () => {
      const result = await dialog.showOpenDialog(this.window!, {
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    });
    ipcMain.handle(IPC.SAVE_HISTORY_CSV, async () => {
      const { entries } = this.db.getHistory(0, 100000);
      const csv = [
        "filename,source_dir,uploaded_at,size,duration_ms,status,sha256,run_id",
        ...entries.map((e: any) =>
          `${e.filename},${e.sourceDir},${new Date(e.uploadedAt).toISOString()},${e.size},${e.durationMs},${e.status},${e.sha256 ?? ""},${e.runId ?? ""}`,
        ),
      ].join("\n");
      const result = await dialog.showSaveDialog(this.window!, {
        title: "Export History CSV",
        defaultPath: "v3-companion-history.csv",
        filters: [{ name: "CSV Files", extensions: ["csv"] }],
      });
      if (result.canceled || !result.filePath) return null;
      const fs = require("node:fs") as typeof import("node:fs");
      fs.writeFileSync(result.filePath, csv, "utf8");
      return result.filePath;
    });
  }

  registerAll(ipcMain: IpcMain) {
    this.registerDataHandlers(ipcMain);
    this.registerWindowHandlers(ipcMain);
  }
}
