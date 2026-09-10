// System tray manager — creates the tray icon and context menu.
import { app, Tray, Menu, nativeImage, BrowserWindow } from "electron";
import path from "node:path";
import { setQuitting } from "./index";
import type { WatcherManager } from "./watcher";

// __dirname is available natively in CommonJS

export class TrayManager {
  private tray: Tray | null = null;
  private window: BrowserWindow | null = null;
  private watcher: WatcherManager | null = null;

  setWindow(window: BrowserWindow) {
    this.window = window;
  }

  setWatcher(watcher: WatcherManager) {
    this.watcher = watcher;
  }

  create() {
    // Use the app icon for the tray, resized to 16x16 for the system tray
    const iconPath = path.join(__dirname, "../../resources/icon.png");
    let icon = nativeImage.createEmpty();
    try {
      const fullIcon = nativeImage.createFromPath(iconPath);
      if (!fullIcon.isEmpty()) {
        // Resize to 16x16 for the tray
        icon = fullIcon.resize({ width: 16, height: 16 });
      }
    } catch {
      // Fallback: empty icon (will show a default system icon)
    }
    if (icon.isEmpty()) {
      // Create a minimal 16x16 blue square as fallback
      icon = nativeImage.createFromBuffer(Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAfUlEQVQ4T2NkoBAwUqifgWoGf6AYg4GBgYkZIM5gYGDfgJkz/wcxYAYjIwMjA4M/ILYBcRmImYGBgYlBGBiYQDIZSBmYmJgYmIEYgZkZmJgYGBiYQDIZSBiYmJgYGJgBmIGZmZgYGBiYQDIZSBiYmJgYGJgBGIHZmZgYGBiYQDIZSBiYmJgYGJgBGIHZmZgYGBiYQDIZSBiYmJgYGJgBGIHZGQAAAJ9p+1p5gQAAAABJRU5ErkJggg==",
        "base64",
      ));
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip("V3 Companion — Watching directories");

    this.tray.on("double-click", () => {
      this.showWindow();
    });

    this.updateMenu();
  }

  private updateMenu(paused = false) {
    if (!this.tray) return;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show Window",
        click: () => this.showWindow(),
      },
      {
        label: paused ? "Resume Watching" : "Pause Watching",
        click: () => {
          const newPaused = !paused;
          if (newPaused) {
            this.watcher?.pauseAll();
          } else {
            this.watcher?.resumeAll();
          }
          this.updateMenu(newPaused);
        },
      },
      {
        label: "Open Settings",
        click: () => {
          this.showWindow();
          this.window?.webContents.send("navigate", "settings");
        },
      },
      { type: "separator" },
      {
        label: "Quit V3 Companion",
        click: () => {
          setQuitting(true);
          app.quit();
        },
      },
    ]);
    this.tray.setContextMenu(contextMenu);
  }

  showWindow() {
    if (this.window) {
      if (this.window.isMinimized()) this.window.restore();
      this.window.show();
      this.window.focus();
    }
  }

  updateTooltip(status: string, watchedCount: number) {
    if (!this.tray) return;
    const statusLabel = status === "watching" ? "Watching" : status === "paused" ? "Paused" : status === "idle" ? "Idle" : "Error";
    this.tray.setToolTip(`V3 Companion — ${statusLabel} ${watchedCount} director${watchedCount === 1 ? "y" : "ies"}`);
  }

  togglePauseLabel(paused: boolean) {
    this.updateMenu(paused);
  }

  destroy() {
    this.tray?.destroy();
    this.tray = null;
  }
}
