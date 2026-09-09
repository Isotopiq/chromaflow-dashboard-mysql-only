// Electron main process entry point.
// Creates the BrowserWindow, sets up the system tray, IPC handlers,
// file watcher, upload queue, and auto-updater.
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import { TrayManager } from "./tray";
import { IpcHandlers } from "./ipc-handlers";
import { WatcherManager } from "./watcher";
import { UploadQueue } from "./upload-queue";
import { ApiClient } from "./api-client";
import { LocalDb } from "./db";
import { ConfigManager } from "./config";
import { setupAutoUpdater } from "./auto-updater";

// __dirname is available natively in CommonJS — no need for import.meta
const isDev = !!process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let watcherManager: WatcherManager | null = null;
let uploadQueue: UploadQueue | null = null;
let apiClient: ApiClient | null = null;
let db: LocalDb | null = null;
let config: ConfigManager | null = null;
let isQuitting = false;

// Exported so tray and IPC handlers can signal a real quit
export function setQuitting(value: boolean) {
  isQuitting = value;
}

// Single-instance lock — prevent multiple companion instances.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1080,
    minHeight: 580,
    frame: false, // Custom title bar
    show: false,
    icon: path.join(__dirname, "../../resources/icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Show window when ready (prevents white flash)
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  // Minimize to tray on close (don't quit) unless user chose "Quit" from tray
  mainWindow.on("close", (e) => {
    if (config?.get("minimizeToTray") !== false && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL!);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  // Initialize core services
  db = new LocalDb();
  config = new ConfigManager();
  apiClient = new ApiClient(config, db);

  // If stayLoggedIn is disabled, clear any persisted token on launch
  if (!config.get("stayLoggedIn")) {
    config.set("token", null);
    config.set("userEmail", null);
  }

  watcherManager = new WatcherManager(db, config);
  uploadQueue = new UploadQueue(db, apiClient, config);
  trayManager = new TrayManager();

  // Wire watcher → queue: when a file is stabilized, enqueue it
  watcherManager.on("file-stabilized", (filePath: string, folderId: string, size: number) => {
    uploadQueue?.enqueue(filePath, folderId, size);
  });

  // Wire queue → renderer: forward progress updates
  uploadQueue.on("progress", (item: any) => {
    mainWindow?.webContents.send("upload:progress", item);
  });
  uploadQueue.on("queue-update", (items: any[]) => {
    mainWindow?.webContents.send("queue:update", items);
  });

  // Wire watcher → renderer: forward status changes
  watcherManager.on("status", (status: string) => {
    mainWindow?.webContents.send("watcher:status", status);
    trayManager?.updateTooltip(status, watcherManager!.getWatchedCount());
  });

  // Wire log → renderer
  db.onLog((entry: any) => {
    mainWindow?.webContents.send("log:entry", entry);
  });

  // Create the window FIRST so IpcHandlers and TrayManager can reference it
  await createWindow();

  // Set up IPC handlers (after window exists)
  const handlers = new IpcHandlers(db, config, apiClient, watcherManager!, uploadQueue, trayManager, mainWindow);
  handlers.registerAll(ipcMain);

  // Create the tray icon (after window exists)
  trayManager.setWindow(mainWindow!);
  trayManager.setWatcher(watcherManager!);
  trayManager.create();

  // Start watching configured folders — try API first, fall back to local.
  // The manager starts in paused mode so the user can edit folders before
  // anything is actually enqueued; they must click Resume All.
  let startedFromApi = false;
  try {
    const folders = await apiClient.listWatchFolders();
    if (folders.length > 0) {
      for (const folder of folders) {
        if (folder.enabled) {
          watcherManager.startWatching(folder);
        }
      }
      startedFromApi = true;
    }
  } catch {
    // API not reachable
  }

  // Also start any local-only folders (not synced to API)
  const localFolders = db.getLocalWatchFolders();
  if (localFolders.length > 0) {
    for (const folder of localFolders) {
      if (folder.enabled) {
        watcherManager.startWatching(folder);
      }
    }
  }

  db.log("INFO", "Watchers loaded in paused mode — click Resume All when ready");

  // Set up auto-updater (production only)
  if (!isDev) {
    setupAutoUpdater(mainWindow!);
  }

  // Start upload queue processor
  uploadQueue.start();
});

// App lifecycle
app.on("window-all-closed", () => {
  // On Windows, quit when all windows are closed unless minimizing to tray
  if (config?.get("minimizeToTray") !== true) {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});

app.on("before-quit", () => {
  setQuitting(true);
  // Clean up resources
  watcherManager?.destroy();
  trayManager?.destroy();
  db?.close();
});
