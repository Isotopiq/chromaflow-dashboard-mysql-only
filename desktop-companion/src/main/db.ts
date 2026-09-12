// Local SQLite database for upload history, queue, logs, and settings.
import Database from "better-sqlite3";
import path from "node:path";
import { app } from "electron";
import { EventEmitter } from "node:events";
import type { LogEntry, LogLevel, QueueItem, HistoryEntry, WatchFolder, AppSettings } from "../shared/ipc-types";

export class LocalDb extends EventEmitter {
  private db: Database.Database;

  constructor() {
    super();
    const userDataPath = app.getPath("userData");
    const dbPath = path.join(userDataPath, "v3-companion.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
    this.migrate();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS upload_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        source_dir TEXT NOT NULL,
        file_path TEXT NOT NULL,
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
        retries INTEGER DEFAULT 0,
        assignment TEXT,
        force INTEGER DEFAULT 0
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

      CREATE TABLE IF NOT EXISTS watch_folders_local (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        enabled INTEGER DEFAULT 1,
        recursive INTEGER DEFAULT 1,
        stabilize_seconds INTEGER DEFAULT 30,
        file_pattern TEXT DEFAULT '*.mzXML',
        method_id TEXT,
        column_id TEXT,
        batch_id TEXT,
        compound_list_id TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_files (
        file_path TEXT PRIMARY KEY,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        processed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_history_uploaded_at ON upload_history(uploaded_at);
    `);

    // Prune old logs (>7 days)
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.db.prepare("DELETE FROM logs WHERE timestamp < ?").run(cutoff);
  }

  private migrate() {
    try {
      this.db.exec("ALTER TABLE upload_history ADD COLUMN file_path TEXT");
    } catch {
      // Column already exists
    }
    try {
      this.db.exec("ALTER TABLE watch_folders_local ADD COLUMN compound_list_id TEXT");
    } catch {
      // Column already exists
    }
    try {
      this.db.exec("ALTER TABLE queue_items ADD COLUMN assignment TEXT");
    } catch {
      // Column already exists
    }
    try {
      this.db.exec("ALTER TABLE queue_items ADD COLUMN force INTEGER DEFAULT 0");
    } catch {
      // Column already exists
    }
    // Backfill file_path for rows that predate the column.
    this.db.exec(`
      UPDATE upload_history
      SET file_path = source_dir || '\\' || filename
      WHERE file_path IS NULL OR file_path = ''
    `);
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_history_file_path ON upload_history(file_path)");
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
        (id, filename, file_path, folder_id, size, status, progress, error, created_at, retries, assignment, force)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      item.id, item.filename, item.filePath, item.folderId, item.size,
      item.status, item.progress, item.error, item.createdAt, item.retries,
      item.assignment ? JSON.stringify(item.assignment) : null,
      item.force ? 1 : 0,
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
      force: r.force === 1,
      assignment: r.assignment ? JSON.parse(r.assignment) : null,
    }));
  }

  deleteQueueItem(id: string) {
    this.db.prepare("DELETE FROM queue_items WHERE id = ?").run(id);
  }

  // ---- History ----
  addHistory(entry: Omit<HistoryEntry, "id">): number {
    const result = this.db.prepare(`
      INSERT INTO upload_history
        (filename, source_dir, file_path, uploaded_at, size, duration_ms, status, sha256, run_id, v3_folder_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.filename, entry.sourceDir, entry.filePath, entry.uploadedAt, entry.size,
      entry.durationMs, entry.status, entry.sha256, entry.runId, entry.v3FolderId,
    );
    return Number(result.lastInsertRowid);
  }

  // ---- Processed files (persistent dedup across restarts) ----
  isFileProcessed(filePath: string, size: number, mtime: number): boolean {
    const r = this.db.prepare(
      "SELECT 1 FROM processed_files WHERE file_path = ? AND size = ? AND mtime = ?",
    ).get(filePath, size, mtime);
    return !!r;
  }

  markFileProcessed(filePath: string, size: number, mtime: number) {
    this.db.prepare(
      "INSERT OR REPLACE INTO processed_files (file_path, size, mtime, processed_at) VALUES (?, ?, ?, ?)",
    ).run(filePath, size, mtime, Date.now());
  }

  clearProcessedFiles() {
    this.db.prepare("DELETE FROM processed_files").run();
  }

  unmarkFileProcessed(filePath: string) {
    this.db.prepare("DELETE FROM processed_files WHERE file_path = ?").run(filePath);
  }

  getHistoryById(id: number): HistoryEntry | null {
    const r = this.db.prepare(
      "SELECT * FROM upload_history WHERE id = ?",
    ).get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      filename: r.filename,
      sourceDir: r.source_dir,
      filePath: r.file_path,
      uploadedAt: r.uploaded_at,
      size: r.size,
      durationMs: r.duration_ms,
      status: r.status,
      sha256: r.sha256,
      runId: r.run_id,
      v3FolderId: r.v3_folder_id,
    };
  }

  deleteHistoryItems(ids: number[]) {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    this.db.prepare(`DELETE FROM upload_history WHERE id IN (${placeholders})`).run(...ids);
  }

  getHistoryByPath(filePath: string): HistoryEntry | null {
    const r = this.db.prepare(
      "SELECT * FROM upload_history WHERE file_path = ? ORDER BY uploaded_at DESC LIMIT 1",
    ).get(filePath) as any;
    if (!r) return null;
    return {
      id: r.id,
      filename: r.filename,
      sourceDir: r.source_dir,
      filePath: r.file_path,
      uploadedAt: r.uploaded_at,
      size: r.size,
      durationMs: r.duration_ms,
      status: r.status,
      sha256: r.sha256,
      runId: r.run_id,
      v3FolderId: r.v3_folder_id,
    };
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
        filePath: r.file_path,
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

  // ---- Local watch folders (work without API) ----
  addLocalWatchFolder(folder: {
    id: string;
    path: string;
    enabled: boolean;
    recursive: boolean;
    stabilizeSeconds: number;
    filePattern?: string;
    methodId?: string | null;
    columnId?: string | null;
    batchId?: string | null;
    compoundListId?: string | null;
    archiveBehavior?: string;
    archivePath?: string | null;
    maxRetries?: number;
  }): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO watch_folders_local
        (id, path, enabled, recursive, stabilize_seconds, file_pattern, method_id, column_id, batch_id, compound_list_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      folder.id,
      folder.path,
      folder.enabled ? 1 : 0,
      folder.recursive ? 1 : 0,
      folder.stabilizeSeconds,
      folder.filePattern ?? "*.mzXML",
      folder.methodId ?? null,
      folder.columnId ?? null,
      folder.batchId ?? null,
      folder.compoundListId ?? null,
      Date.now(),
    );
  }

  getLocalWatchFolders(): WatchFolder[] {
    const rows = this.db.prepare("SELECT * FROM watch_folders_local ORDER BY created_at ASC").all() as any[];
    return rows.map((r) => {
      const local = this.getWatchFolderLocal(r.id);
      return {
        id: r.id,
        path: r.path,
        enabled: !!r.enabled,
        recursive: !!r.recursive,
        stabilizeSeconds: r.stabilize_seconds,
        filePattern: r.file_pattern,
        methodId: r.method_id,
        columnId: r.column_id,
        batchId: r.batch_id,
        compoundListId: r.compound_list_id,
        archiveBehavior: (local?.archiveBehavior as WatchFolder["archiveBehavior"]) ?? "leave",
        archivePath: local?.archivePath ?? null,
        maxRetries: local?.maxRetries ?? 3,
      };
    });
  }

  /**
   * Merge an API-returned watch folder with desktop-local settings
   * (recursive, stabilizeSeconds, archive options) that the server
   * does not store. The API row is authoritative for shared fields.
   */
  mergeWatchFolder(folder: WatchFolder): WatchFolder {
    const full = this.db.prepare("SELECT * FROM watch_folders_local WHERE id = ?").get(folder.id) as any;
    const local = this.getWatchFolderLocal(folder.id);
    return {
      ...folder,
      recursive: full ? !!full.recursive : (local?.recursive ?? true),
      stabilizeSeconds: full?.stabilize_seconds ?? local?.stabilizeSeconds ?? 30,
      filePattern: full?.file_pattern ?? folder.filePattern ?? "*.mzXML",
      methodId: folder.methodId ?? full?.method_id ?? null,
      columnId: folder.columnId ?? full?.column_id ?? null,
      batchId: folder.batchId ?? full?.batch_id ?? null,
      compoundListId: folder.compoundListId !== undefined ? folder.compoundListId : (full?.compound_list_id ?? null),
      archiveBehavior: (local?.archiveBehavior as WatchFolder["archiveBehavior"]) ?? "leave",
      archivePath: local?.archivePath ?? null,
      maxRetries: local?.maxRetries ?? 3,
    };
  }

  updateLocalWatchFolder(id: string, patch: Partial<{
    enabled: boolean;
    recursive: boolean;
    stabilizeSeconds: number;
    filePattern: string;
    methodId: string | null;
    columnId: string | null;
    batchId: string | null;
    compoundListId: string | null;
  }>): void {
    const current = this.db.prepare("SELECT * FROM watch_folders_local WHERE id = ?").get(id) as any;
    if (!current) return;
    this.db.prepare(`
      UPDATE watch_folders_local SET
        enabled = ?,
        recursive = ?,
        stabilize_seconds = ?,
        file_pattern = ?,
        method_id = ?,
        column_id = ?,
        batch_id = ?,
        compound_list_id = ?
      WHERE id = ?
    `).run(
      (patch.enabled ?? !!current.enabled) ? 1 : 0,
      (patch.recursive ?? !!current.recursive) ? 1 : 0,
      patch.stabilizeSeconds ?? current.stabilize_seconds,
      patch.filePattern ?? current.file_pattern,
      patch.methodId !== undefined ? patch.methodId : current.method_id,
      patch.columnId !== undefined ? patch.columnId : current.column_id,
      patch.batchId !== undefined ? patch.batchId : current.batch_id,
      patch.compoundListId !== undefined ? patch.compoundListId : current.compound_list_id,
      id,
    );
  }

  removeLocalWatchFolder(id: string): void {
    this.db.prepare("DELETE FROM watch_folders_local WHERE id = ?").run(id);
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
  resetStats() {
    this.db.prepare("DELETE FROM upload_history").run();
    this.db.prepare("DELETE FROM processed_files").run();
    this.db.prepare("DELETE FROM logs WHERE message LIKE 'Detected %' OR message LIKE 'Stabilized %' OR message LIKE 'Upload complete%' OR message LIKE 'Upload failed%' OR message LIKE 'Retry %'").run();
  }

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

    const detected = (this.db.prepare(
      "SELECT COUNT(*) as count FROM logs WHERE timestamp >= ? AND message LIKE 'Detected %'",
    ).get(todayMs) as any)?.count ?? 0;

    const queueDepth = (this.db.prepare(
      "SELECT COUNT(*) as count FROM queue_items WHERE status IN ('queued', 'uploading', 'parsing', 'pending')",
    ).get() as any)?.count ?? 0;

    return {
      filesDetected: Math.max(detected, succeeded + failed),
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
