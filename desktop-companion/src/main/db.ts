// Local SQLite database for upload history, queue, logs, and settings.
import Database from "better-sqlite3";
import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "node:events";
import type { LogEntry, LogLevel, QueueItem, HistoryEntry, WatchFolder, AppSettings } from "@shared/ipc-types";

export class LocalDb extends EventEmitter {
  private db: Database.Database;

  constructor() {
    super();
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "v3-companion.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS upload_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        source_dir TEXT NOT NULL,
        uploaded_at INTEGER NOT NULL,
        size INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        sha256 TEXT,
        run_id TEXT,
        v3_folder_id TEXT
      );

      CREATE TABLE IF NOT EXISTS queue_items (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        file_path TEXT NOT NULL,
        folder_id TEXT NOT NULL,
        size INTEGER NOT NULL,
        status TEXT NOT NULL,
        progress INTEGER DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        retries INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watch_folder_local (
        v3_folder_id TEXT PRIMARY KEY,
        recursive INTEGER DEFAULT 1,
        stabilize_seconds INTEGER DEFAULT 30,
        archive_behavior TEXT DEFAULT 'leave',
        archive_path TEXT,
        max_retries INTEGER DEFAULT 3
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_history_uploaded_at ON upload_history(uploaded_at);
    `);

    // Prune old logs (>7 days)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM logs WHERE timestamp < ?").run(cutoff);
  }

  // ---- Logs ----
  log(level: LogLevel, message: string) {
    const entry: LogEntry = {
      id: 0,
      timestamp: Date.now(),
      level,
      message,
    };
    const result = this.db.prepare(
      "INSERT INTO logs (timestamp, level, message) VALUES (?, ?, ?)",
    ).run(entry.timestamp, entry.level, entry.message);
    entry.id = Number(result.lastInsertRowid);
    this.emit("log", entry);
  }

  getLogs(limit = 200, level?: LogLevel): LogEntry[] {
    if (level && level !== "DEBUG") {
      return this.db.prepare(
        "SELECT * FROM logs WHERE level = ? ORDER BY timestamp DESC LIMIT ?",
      ).all(level, limit) as LogEntry[];
    }
    return this.db.prepare(
      "SELECT * FROM logs ORDER BY timestamp DESC LIMIT ?",
    ).all(limit) as LogEntry[];
  }

  clearLogs() {
    this.db.prepare("DELETE FROM logs").run();
  }

  onLog(callback: (entry: LogEntry) => void) {
    this.on("log", callback);
  }

  // ---- Queue ----
  saveQueueItem(item: QueueItem) {
    this.db.prepare(`
      INSERT OR REPLACE INTO queue_items
        (id, filename, file_path, folder_id, size, status, progress, error, created_at, retries)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id, item.filename, item.filePath, item.folderId, item.size,
      item.status, item.progress, item.error, item.createdAt, item.retries,
    );
  }

  getQueueItems(): QueueItem[] {
    const rows = this.db.prepare(
      "SELECT * FROM queue_items ORDER BY created_at DESC",
    ).all() as any[];
    return rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      filePath: r.file_path,
      folderId: r.folder_id,
      size: r.size,
      status: r.status,
      progress: r.progress,
      error: r.error,
      createdAt: r.created_at,
      retries: r.retries,
    }));
  }

  deleteQueueItem(id: string) {
    this.db.prepare("DELETE FROM queue_items WHERE id = ?").run(id);
  }

  // ---- History ----
  addHistory(entry: Omit<HistoryEntry, "id">): number {
    const result = this.db.prepare(`
      INSERT INTO upload_history
        (filename, source_dir, uploaded_at, size, duration_ms, status, sha256, run_id, v3_folder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.filename, entry.sourceDir, entry.uploadedAt, entry.size,
      entry.durationMs, entry.status, entry.sha256, entry.runId, entry.v3FolderId,
    );
    return Number(result.lastInsertRowid);
  }

  getHistory(page: number, pageSize: number): { entries: HistoryEntry[]; total: number } {
    const offset = page * pageSize;
    const entries = this.db.prepare(
      "SELECT * FROM upload_history ORDER BY uploaded_at DESC LIMIT ? OFFSET ?",
    ).all(pageSize, offset) as any[];
    const total = (this.db.prepare("SELECT COUNT(*) as count FROM upload_history").get() as any)?.count ?? 0;
    return {
      entries: entries.map((r) => ({
        id: r.id,
        filename: r.filename,
        sourceDir: r.source_dir,
        uploadedAt: r.uploaded_at,
        size: r.size,
        durationMs: r.duration_ms,
        status: r.status,
        sha256: r.sha256,
        runId: r.run_id,
        v3FolderId: r.v3_folder_id,
      })),
      total,
    };
  }

  clearHistory() {
    this.db.prepare("DELETE FROM upload_history").run();
  }

  getHistoryByPath(filePath: string): HistoryEntry | null {
    const r = this.db.prepare(
      "SELECT * FROM upload_history WHERE source_dir || '\\' || filename = ? ORDER BY uploaded_at DESC LIMIT 1",
    ).get(filePath) as any;
    if (!r) return null;
    return {
      id: r.id,
      filename: r.filename,
      sourceDir: r.source_dir,
      uploadedAt: r.uploaded_at,
      size: r.size,
      durationMs: r.duration_ms,
      status: r.status,
      sha256: r.sha256,
      runId: r.run_id,
      v3FolderId: r.v3_folder_id,
    };
  }

  // ---- Watch folder local settings ----
  getWatchFolderLocal(folderId: string) {
    const r = this.db.prepare(
      "SELECT * FROM watch_folder_local WHERE v3_folder_id = ?",
    ).get(folderId) as any;
    if (!r) return null;
    return {
      recursive: !!r.recursive,
      stabilizeSeconds: r.stabilize_seconds,
      archiveBehavior: r.archive_behavior,
      archivePath: r.archive_path,
      maxRetries: r.max_retries,
    };
  }

  setWatchFolderLocal(folderId: string, settings: {
    recursive?: boolean;
    stabilizeSeconds?: number;
    archiveBehavior?: string;
    archivePath?: string | null;
    maxRetries?: number;
  }) {
    const existing = this.getWatchFolderLocal(folderId) ?? {
      recursive: true,
      stabilizeSeconds: 30,
      archiveBehavior: "leave",
      archivePath: null,
      maxRetries: 3,
    };
    const merged = { ...existing, ...settings };
    this.db.prepare(`
      INSERT OR REPLACE INTO watch_folder_local
        (v3_folder_id, recursive, stabilize_seconds, archive_behavior, archive_path, max_retries)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      folderId,
      merged.recursive ? 1 : 0,
      merged.stabilizeSeconds,
      merged.archiveBehavior,
      merged.archivePath,
      merged.maxRetries,
    );
  }

  // ---- Settings ----
  getSetting(key: string): string | null {
    const r = this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as any;
    return r?.value ?? null;
  }

  setSetting(key: string, value: string) {
    this.db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)").run(key, value);
  }

  getAllSettings(): Record<string, string> {
    const rows = this.db.prepare("SELECT key, value FROM app_settings").all() as any[];
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key] = r.value;
    return result;
  }

  // ---- Dashboard stats ----
  getDashboardStats(): {
    filesDetected: number;
    uploadsSucceeded: number;
    uploadsFailed: number;
    queueDepth: number;
  } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const succeeded = (this.db.prepare(
      "SELECT COUNT(*) as count FROM upload_history WHERE status = 'done' AND uploaded_at >= ?",
    ).get(todayMs) as any)?.count ?? 0;

    const failed = (this.db.prepare(
      "SELECT COUNT(*) as count FROM upload_history WHERE status = 'failed' AND uploaded_at >= ?",
    ).get(todayMs) as any)?.count ?? 0;

    const total = (this.db.prepare(
      "SELECT COUNT(*) as count FROM upload_history WHERE uploaded_at >= ?",
    ).get(todayMs) as any)?.count ?? 0;

    const queueDepth = (this.db.prepare(
      "SELECT COUNT(*) as count FROM queue_items WHERE status IN ('queued', 'uploading', 'parsing')",
    ).get() as any)?.count ?? 0;

    return {
      filesDetected: total,
      uploadsSucceeded: succeeded,
      uploadsFailed: failed,
      queueDepth,
    };
  }

  getHourlyUploads(): { h: string; v: number }[] {
    const now = new Date();
    const result: { h: string; v: number }[] = [];
    for (let i = 23; i >= 0; i--) {
      const hourStart = new Date(now);
      hourStart.setMinutes(0, 0, 0);
      hourStart.setHours(now.getHours() - i);
      const hourEnd = hourStart.getTime() + 60 * 60 * 1000;
      const count = (this.db.prepare(
        "SELECT COUNT(*) as count FROM upload_history WHERE uploaded_at >= ? AND uploaded_at < ?",
      ).get(hourStart.getTime(), hourEnd) as any)?.count ?? 0;
      const h = hourStart.getHours() === 0 ? "12a" : hourStart.getHours() < 12 ? `${hourStart.getHours()}a` : hourStart.getHours() === 12 ? "12p" : `${hourStart.getHours() - 12}p`;
      result.push({ h, v: count });
    }
    return result;
  }

  close() {
    this.db.close();
  }
}
