// Auto-updater — checks for updates on app launch and notifies the user.
import { autoUpdater } from "electron-updater";
import { BrowserWindow } from "electron";

export function setupAutoUpdater(window: BrowserWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    window.webContents.send("toast", {
      type: "info",
      message: `Update available: v${info.version}. Click to download.`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    window.webContents.send("toast", {
      type: "success",
      message: `Update v${info.version} downloaded. Restart to install.`,
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("[auto-updater]", err);
  });

  // Check for updates after a short delay (let the app start first)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {
      // Silent fail — auto-update is best-effort
    });
  }, 5000);
}
