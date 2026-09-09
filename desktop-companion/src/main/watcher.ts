// File watcher manager — uses chokidar to watch directories for mzXML/mzML files.
// Implements file stabilization (wait for file size to stop changing before enqueueing).
import chokidar, { type FSWatcher } from "chokidar";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { LocalDb } from "./db";
import type { ConfigManager } from "./config";
import type { WatchFolder, WatcherStatus } from "../shared/ipc-types";

const VALID_EXTENSIONS = [".mzxml", ".mzml"];

export class WatcherManager extends EventEmitter {
  private db: LocalDb;
  private config: ConfigManager;
  private watchers: Map<string, FSWatcher> = new Map();
  private folders: Map<string, WatchFolder> = new Map();
  private stabilizationTimers: Map<string, NodeJS.Timeout> = new Map();
  private fileSizes: Map<string, number> = new Map();
  private paused = true;
  private status: WatcherStatus = "idle";

  constructor(db: LocalDb, config: ConfigManager) {
    super();
    this.db = db;
    this.config = config;
  }

  async startAll() {
    // Folders are loaded and started from index.ts after API client is ready
    this.updateStatus();
    this.emit("status", this.status);
  }

  async startWatching(folder: WatchFolder) {
    // Stop existing watcher for this folder if any
    this.stopWatching(folder.id);

    this.folders.set(folder.id, folder);

    if (!folder.enabled) return;

    // Chokidar v4 removed glob support — watch the directory directly
    // and filter by extension in the add/change handlers.
    // ignoreInitial: false so existing files are also detected on startup.
    const watcher = chokidar.watch(folder.path, {
      persistent: true,
      ignoreInitial: false,
      depth: folder.recursive ? undefined : 0,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 500,
      },
    });

    watcher.on("add", (filePath: string) => {
      this.handleFileDetected(filePath, folder);
    });

    watcher.on("change", (filePath: string) => {
      this.handleFileDetected(filePath, folder);
    });

    watcher.on("error", (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.db.log("ERROR", `Watcher error on ${folder.path}: ${message}`);
      this.status = "error";
      this.emit("status", this.status);
    });

    this.watchers.set(folder.id, watcher);
    this.db.log("INFO", `Watcher started on ${folder.path} (recursive: ${folder.recursive})`);

    // Update status
    if (!this.paused) {
      this.updateStatus();
      this.emit("status", this.status);
    }
  }

  stopWatching(folderId: string) {
    const watcher = this.watchers.get(folderId);
    if (watcher) {
      watcher.close().catch(() => {});
      this.watchers.delete(folderId);
    }
    this.folders.delete(folderId);
    // If no more watchers, go idle
    if (this.watchers.size === 0 && !this.paused) {
      this.updateStatus();
      this.emit("status", this.status);
    }
  }

  private handleFileDetected(filePath: string, folder: WatchFolder) {
    if (this.paused) return;

    // Check extension
    const ext = path.extname(filePath).toLowerCase();
    if (!VALID_EXTENSIONS.includes(ext)) return;

    // Record file size + mtime
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
      this.fileSizes.set(filePath, stat.size);
    } catch {
      return;
    }

    // Skip files that were already processed in a previous session.
    // Keyed on path + size + mtime so a genuinely new/changed file
    // at the same path still gets picked up.
    if (this.db.isFileProcessed(filePath, stat.size, stat.mtimeMs)) {
      return;
    }

    // Check if already in history (already uploaded) — skip duplicates
    const existing = this.db.getHistoryByPath(filePath);
    if (existing && existing.status === "done") {
      this.db.markFileProcessed(filePath, stat.size, stat.mtimeMs);
      return; // Already uploaded successfully
    }

    // Clear any existing stabilization timer for this file
    const existingTimer = this.stabilizationTimers.get(filePath);
    if (existingTimer) clearTimeout(existingTimer);

    const size = this.fileSizes.get(filePath) ?? 0;
    this.db.log("INFO", `Detected ${path.basename(filePath)} (${this.formatSize(size)}) — stabilizing…`);

    // Set stabilization timer
    const delay = (folder.stabilizeSeconds || this.config.get("defaultStabilizeSeconds")) * 1000;
    const timer = setTimeout(() => {
      this.checkStabilized(filePath, folder.id, size);
    }, delay);

    this.stabilizationTimers.set(filePath, timer);
  }

  private checkStabilized(filePath: string, folderId: string, originalSize: number) {
    this.stabilizationTimers.delete(filePath);

    try {
      const stat = fs.statSync(filePath);
      if (stat.size !== originalSize) {
        // File is still being written — restart timer
        this.fileSizes.set(filePath, stat.size);
        const folder = this.folders.get(folderId);
        if (folder) {
          const delay = (folder.stabilizeSeconds || this.config.get("defaultStabilizeSeconds")) * 1000;
          const timer = setTimeout(() => {
            this.checkStabilized(filePath, folderId, stat.size);
          }, delay);
          this.stabilizationTimers.set(filePath, timer);
        }
        return;
      }

      // File is stable — mark as processed so it isn't re-detected on
      // next app launch, then emit the event.
      this.db.markFileProcessed(filePath, stat.size, stat.mtimeMs);
      this.db.log("INFO", `Stabilized ${path.basename(filePath)} — queued for upload`);
      this.emit("file-stabilized", filePath, folderId, stat.size);
    } catch (err: any) {
      this.db.log("ERROR", `File disappeared during stabilization: ${filePath}`);
    }
  }

  pauseAll() {
    this.paused = true;
    this.status = "paused";
    this.emit("status", this.status);
    this.db.log("INFO", "All watchers paused");
  }

  resumeAll() {
    this.paused = false;
    this.updateStatus();
    this.emit("status", this.status);
    this.db.log("INFO", "All watchers resumed");
  }

  getStatus(): WatcherStatus {
    return this.status;
  }

  getWatchedCount(): number {
    return this.watchers.size;
  }

  private updateStatus() {
    if (this.paused) {
      this.status = "paused";
    } else if (this.watchers.size === 0) {
      this.status = "idle";
    } else {
      this.status = "watching";
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }

  destroy() {
    for (const [, watcher] of this.watchers) {
      watcher.close().catch(() => {});
    }
    this.watchers.clear();
    for (const [, timer] of this.stabilizationTimers) {
      clearTimeout(timer);
    }
    this.stabilizationTimers.clear();
  }
}
