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
    width: 1000,
    height: 650,
    minWidth: 900,
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

  // Set up IPC handlers
  const handlers = new IpcHandlers(db, config, apiClient, watcherManager!, uploadQueue, trayManager, mainWindow);
  handlers.registerAll(ipcMain);

  // Start watching configured folders
  await watcherManager.startAll();

  // Create the window
  await createWindow();

  // Set up auto-updater (production only)
  if (!isDev) {
    setupAutoUpdater(mainWindow!);
  }

  // Start upload queue processor
  uploadQueue.start();
});

// App lifecycle
app.on("window-all-closed", () => {
  // On Windows, keep running in the tray
  // The app only quits via tray "Quit" or explicit app.quit()
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else {
    mainWindow?.show();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
});
