// System tray manager — creates the tray icon and context menu.
import { app, Tray, Menu, nativeImage, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class TrayManager {
  private tray: Tray | null = null;
  private window: BrowserWindow | null = null;

  setWindow(window: BrowserWindow) {
    this.window = window;
  }

  create() {
    // Use a simple 16x16 icon for the tray
    const iconPath = path.join(__dirname, "../../resources/tray-icon.png");
    let icon = nativeImage.createEmpty();
    try {
      icon = nativeImage.createFromPath(iconPath);
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
          // Emit a custom event that the main process can handle
          (this.tray as any)?.emit("toggle-pause");
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
          (app as any).isQuitting = true;
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
    const statusLabel = status === "watching" ? "Watching" : status === "paused" ? "Paused" : "Error";
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
