// Upload queue processor — manages the upload pipeline with concurrency + retries.
// Pipeline: parse → hash → get upload URLs → upload → create run → record history.
import { EventEmitter } from "node:events";
import { Worker } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import type { LocalDb } from "./db";
import type { ApiClient } from "./api-client";
import type { ConfigManager } from "./config";
import type { WatcherManager } from "./watcher";
import type { QueueItem, UploadStatus } from "../shared/ipc-types";

export class UploadQueue extends EventEmitter {
  private db: LocalDb;
  private api: ApiClient;
  private config: ConfigManager;
  private watcher: WatcherManager;
  private queue: QueueItem[] = [];
  private active: Map<string, AbortController> = new Map();
  private activeWorkers: Map<string, Worker> = new Map();
  private processing = false;
  private paused = true;

  constructor(db: LocalDb, api: ApiClient, config: ConfigManager, watcher: WatcherManager) {
    super();
    this.db = db;
    this.api = api;
    this.config = config;
    this.watcher = watcher;

    // Load persisted queue items on startup. Any item left in a transient
    // state (parsing/uploading) by a previous session is reset to queued so
    // it can be picked up again once the user resumes.
    this.queue = this.db.getQueueItems().map((item) => {
      if (item.status === "parsing" || item.status === "uploading") {
        const recovered = { ...item, status: "queued" as const, progress: 0, error: null };
        this.db.saveQueueItem(recovered);
        return recovered;
      }
      return item;
    });
  }

  start() {
    this.processing = true;
    this.processNext();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused) this.processNext();
    this.emit("queue-update", this.getQueue());
  }

  enqueue(filePath: string, folderId: string, size: number, opts?: { force?: boolean }) {
    // Don't enqueue if already in the queue
    const existing = this.queue.find(
      (q) => q.filePath === filePath && (q.status === "queued" || q.status === "parsing" || q.status === "uploading"),
    );
    if (existing) return;

    const id = crypto.randomUUID();
    const item: QueueItem = {
      id,
      filename: path.basename(filePath),
      filePath,
      folderId,
      size,
      status: "queued",
      progress: 0,
      error: null,
      createdAt: Date.now(),
      retries: 0,
      force: opts?.force,
    };
    this.queue.push(item);
    this.db.saveQueueItem(item);
    this.emit("queue-update", this.getQueue());
    this.processNext();
  }

  getQueue(): QueueItem[] {
    return [...this.queue].sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(id: string) {
    const controller = this.active.get(id);
    if (controller) {
      controller.abort();
      this.active.delete(id);
    }
    this.activeWorkers.get(id)?.terminate();
    this.activeWorkers.delete(id);
    const item = this.queue.find((q) => q.id === id);
    if (item) {
      item.status = "cancelled";
      item.error = "Cancelled by user";
      this.db.saveQueueItem(item);
      this.markFileAsProcessed(item.filePath, item.size);
      this.db.addHistory({
        filename: item.filename,
        sourceDir: path.dirname(item.filePath),
        filePath: item.filePath,
        uploadedAt: Date.now(),
        size: item.size,
        durationMs: 0,
        status: "cancelled",
        sha256: null,
        runId: null,
        v3FolderId: item.folderId,
      });
    }
    this.queue = this.queue.filter((q) => q.id !== id);
    this.db.deleteQueueItem(id);
    this.emit("queue-update", this.getQueue());
  }

  retry(id: string) {
    const item = this.queue.find((q) => q.id === id);
    if (item && item.status === "failed") {
      item.status = "queued";
      item.error = null;
      item.retries = 0;
      this.db.saveQueueItem(item);
      this.emit("queue-update", this.getQueue());
      this.processNext();
    }
  }

  remove(id: string) {
    // Cancel if actively uploading
    const controller = this.active.get(id);
    if (controller) {
      controller.abort();
      this.active.delete(id);
    }
    this.activeWorkers.get(id)?.terminate();
    this.activeWorkers.delete(id);
    const item = this.queue.find((q) => q.id === id);
    if (item) {
      this.markFileAsProcessed(item.filePath, item.size);
    }
    this.queue = this.queue.filter((q) => q.id !== id);
    this.db.deleteQueueItem(id);
    this.emit("queue-update", this.getQueue());
  }

  private markFileAsProcessed(filePath: string, size: number) {
    try {
      const stat = fs.statSync(filePath);
      this.watcher.markFileAsProcessed(filePath, stat.size, stat.mtimeMs);
    } catch {
      // File may have been deleted; use the last known size and now() as mtime.
      this.watcher.markFileAsProcessed(filePath, size, Date.now());
    }
  }

  clearCompleted() {
    const doneIds = this.queue.filter((q) => q.status === "done").map((q) => q.id);
    for (const id of doneIds) {
      const item = this.queue.find((q) => q.id === id);
      if (item) this.markFileAsProcessed(item.filePath, item.size);
    }
    this.queue = this.queue.filter((q) => q.status !== "done");
    for (const id of doneIds) this.db.deleteQueueItem(id);
    this.emit("queue-update", this.getQueue());
  }

  clearFailed() {
    const failedIds = this.queue.filter((q) => q.status === "failed" || q.status === "cancelled").map((q) => q.id);
    for (const id of failedIds) {
      const item = this.queue.find((q) => q.id === id);
      if (item) this.markFileAsProcessed(item.filePath, item.size);
    }
    this.queue = this.queue.filter((q) => q.status !== "failed" && q.status !== "cancelled");
    for (const id of failedIds) this.db.deleteQueueItem(id);
    this.emit("queue-update", this.getQueue());
  }

  clearAll() {
    // Abort all active uploads and parsing workers
    for (const [, controller] of this.active) {
      controller.abort();
    }
    this.active.clear();
    for (const [, worker] of this.activeWorkers) {
      worker.terminate();
    }
    this.activeWorkers.clear();
    // Mark every pending/completed/failed item as processed before removing
    for (const item of this.queue) {
      this.markFileAsProcessed(item.filePath, item.size);
    }
    // Remove all items
    const allIds = this.queue.map((q) => q.id);
    this.queue = [];
    for (const id of allIds) this.db.deleteQueueItem(id);
    this.emit("queue-update", this.getQueue());
  }

  private async processNext() {
    if (!this.processing || this.paused) return;

    const maxConcurrent = this.config.get("maxConcurrentUploads");
    const activeCount = this.active.size;
    if (activeCount >= maxConcurrent) return;

    const next = this.queue.find((q) => q.status === "queued");
    if (!next) return;

    next.status = "parsing";
    this.db.saveQueueItem(next);
    this.emit("queue-update", this.getQueue());

    const controller = new AbortController();
    this.active.set(next.id, controller);

    try {
      await this.processItem(next, controller.signal);
      next.status = "done";
      next.progress = 100;
      this.db.saveQueueItem(next);
      this.db.log("INFO", `Upload complete: ${next.filename}`);
      // Remove completed upload from the queue (it already lives in history from processItem).
      this.queue = this.queue.filter((q) => q.id !== next.id);
      this.db.deleteQueueItem(next.id);
      this.markFileAsProcessed(next.filePath, next.size);
    } catch (err: any) {
      const stillInQueue = this.queue.some((q) => q.id === next.id);
      if (!stillInQueue || controller.signal.aborted || (next.status as string) === "cancelled") {
        // The item was cancelled or removed while processing — do not resurrect it.
      } else {
        next.status = "failed";
        next.error = err?.message ?? "Upload failed";
        this.db.saveQueueItem(next);
        this.db.log("ERROR", `Upload failed: ${next.filename} — ${next.error}`);

        // Record the failure in history so the dashboard reflects it.
        this.db.addHistory({
          filename: next.filename,
          sourceDir: path.dirname(next.filePath),
          filePath: next.filePath,
          uploadedAt: Date.now(),
          size: next.size,
          durationMs: 0,
          status: "failed",
          sha256: null,
          runId: null,
          v3FolderId: next.folderId,
        });
        // Mark as processed so the watcher will not attempt to upload it again.
        this.markFileAsProcessed(next.filePath, next.size);
      }
    } finally {
      this.active.delete(next.id);
      this.activeWorkers.delete(next.id);
      this.emit("queue-update", this.getQueue());
      this.processNext();
    }
  }

  private async processItem(item: QueueItem, signal: AbortSignal) {
    // 1. Parse the file in a worker thread
    item.status = "parsing";
    this.emit("progress", item);

    const parsed = await this.parseFile(item.id, item.filePath);
    if (signal.aborted) throw new Error("Cancelled by user");

    // 2. Compute SHA-256 hash
    const hash = await this.computeHash(item.filePath);
    if (signal.aborted) throw new Error("Cancelled by user");

    // 3. Check for duplicates (skipped when the user explicitly re-uploads)
    if (!item.force) {
      try {
        const existing = await this.api.findRunByPath(item.filePath);
        if (existing.run) {
          this.db.log("INFO", `File already uploaded: ${item.filename} (run exists)`);
          item.status = "done";
          item.progress = 100;
          return;
        }
      } catch {
        // Ignore dedup check errors — proceed with upload
      }
    }

    // 4. Get upload URLs
    item.status = "uploading";
    item.progress = 10;
    this.emit("progress", item);

    const [rawUrl, scansUrl, ms2Url] = await Promise.all([
      this.api.getUploadUrl({ filename: item.filename, bucket: "raw-runs" }),
      this.api.getUploadUrl({ filename: item.filename, bucket: "raw-runs", suffix: ".scans.bin" }),
      this.api.getUploadUrl({ filename: item.filename, bucket: "raw-runs", suffix: ".ms2.bin" }),
    ]);

    // 5. Upload raw file
    const rawFile = fs.readFileSync(item.filePath);
    await this.uploadFile(rawUrl.signedUrl, rawFile, signal, (progress) => {
      item.progress = 10 + Math.floor(progress * 0.6); // 10-70%
      this.emit("progress", item);
    });

    // 6. Upload scans blob
    if (parsed.scansBlob && parsed.scansBlob.length > 0) {
      await this.uploadFile(scansUrl.signedUrl, Buffer.from(parsed.scansBlob), signal, (progress) => {
        item.progress = 70 + Math.floor(progress * 0.15); // 70-85%
        this.emit("progress", item);
      });
    }

    // 7. Upload MS2 blob
    if (parsed.ms2Blob && parsed.ms2Blob.length > 0) {
      await this.uploadFile(ms2Url.signedUrl, Buffer.from(parsed.ms2Blob), signal, (progress) => {
        item.progress = 85 + Math.floor(progress * 0.1); // 85-95%
        this.emit("progress", item);
      });
    }

    // 8. Resolve folder metadata and create run — clamp trace arrays + peaks to server-side zod limits
    if (signal.aborted) throw new Error("Cancelled by user");
    item.progress = 95;
    this.emit("progress", item);

    const folder = this.watcher.getFolder(item.folderId);
    if (!folder?.columnId) {
      this.emit("toast", { type: "warn", message: `${item.filename} is uploading without a column; the run will not appear in Column/Method/Batch portal views until one is set.` });
    }

    const clampArray = (arr: number[], max: number) => {
      if (arr.length <= max) return arr;
      const step = arr.length / max;
      const out: number[] = [];
      for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
      return out;
    };
    const MAX_TRACE = 8000;
    const MAX_PEAKS = 1000;
    const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const numOrNull = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);

    const runResult = await this.api.createRun({
      name: item.filename.replace(/\.(mzXML|mzML)$/i, "").slice(0, 300) || item.filename,
      methodId: folder?.methodId ?? null,
      columnId: folder?.columnId ?? null,
      batchId: folder?.batchId ?? null,
      filePath: rawUrl.path.slice(0, 500),
      scansBlobPath: scansUrl.path,
      fileFormat: parsed.summary.format === "mzXML" ? "mzXML" : "mzML",
      compoundListId: folder?.compoundListId ?? null,
      fileSize: this.formatSize(item.size).slice(0, 40),
      ionMode: parsed.summary.ionMode === "negative" ? "negative" : "positive",
      msLevel: Math.min(3, Math.max(1, Math.floor(num(parsed.summary.msLevel) || 1))),
      trace: {
        x: clampArray((parsed.summary.trace.x ?? []).map(num), MAX_TRACE),
        tic: clampArray((parsed.summary.trace.tic ?? []).map(num), MAX_TRACE),
        bpc: clampArray((parsed.summary.trace.bpc ?? []).map(num), MAX_TRACE),
      },
      peaks: (parsed.summary.peaks ?? []).slice(0, MAX_PEAKS).map((p: any) => ({
        rt: num(p.rt),
        area: num(p.area),
        height: num(p.height),
        fwhm: num(p.fwhm),
        sn: num(p.sn),
        mz: numOrNull(p.mz),
        mzLow: numOrNull(p.mzLow),
        mzHigh: numOrNull(p.mzHigh),
        r2: numOrNull(p.r2),
        asymmetry: numOrNull(p.asymmetry),
      })),
    });

    // 9. Record in history
    this.db.addHistory({
      filename: item.filename,
      sourceDir: path.dirname(item.filePath),
      filePath: item.filePath,
      uploadedAt: Date.now(),
      size: item.size,
      durationMs: 0, // TODO: track duration
      status: "done",
      sha256: hash,
      runId: runResult.run?.id ?? null,
      v3FolderId: item.folderId,
    });

    item.progress = 100;
    this.emit("progress", item);
  }

  private async parseFile(itemId: string, filePath: string): Promise<{
    summary: {
      format: string;
      ionMode: string;
      msLevel: number;
      trace: { x: number[]; tic: number[]; bpc: number[] };
      peaks: any[];
    };
    scansBlob: Uint8Array;
    ms2Blob: Uint8Array;
  }> {
    return new Promise((resolve, reject) => {
      // The worker lives inside the asar in packaged builds unless unpacked;
      // prefer the unpacked path when it exists.
      const bundled = path.join(__dirname, "parser-worker.js");
      const unpacked = bundled.replace("app.asar", "app.asar.unpacked");
      const workerPath = fs.existsSync(unpacked) ? unpacked : bundled;
      const worker = new Worker(workerPath, { workerData: filePath });
      this.activeWorkers.set(itemId, worker);

      const timeout = setTimeout(() => {
        worker.terminate();
        this.activeWorkers.delete(itemId);
        reject(new Error("Parse timeout (5 min)"));
      }, 5 * 60 * 1000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.activeWorkers.delete(itemId);
      };

      worker.on("message", (msg: any) => {
        cleanup();
        if (msg.ok) {
          resolve(msg);
        } else {
          reject(new Error(msg.error || "Parse failed"));
        }
        worker.terminate();
      });

      worker.on("error", (err) => {
        cleanup();
        reject(err);
      });

      worker.on("exit", (code) => {
        if (code !== 0) {
          cleanup();
          reject(new Error(`Parser worker exited with code ${code}`));
        }
      });
    });
  }

  private async computeHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);
      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  private async uploadFile(
    url: string,
    data: Buffer | Uint8Array,
    signal: AbortSignal,
    onProgress: (progress: number) => void,
  ) {
    // The server may return a relative URL (e.g. /api/upload?token=...) when
    // using local filesystem storage instead of S3. Resolve it against the
    // configured API endpoint.
    let fullUrl = url;
    if (url.startsWith("/")) {
      const base = this.config.get("apiEndpoint").replace(/\/+$/, "");
      fullUrl = `${base}${url}`;
    }

    // For local-storage URLs, split large uploads into 8 MB chunks so each
    // request finishes well inside the reverse proxy's timeout (Easypanel /
    // Traefik kills requests that run too long — caused 504s on big files).
    const isLocalUpload = url.startsWith("/api/upload");
    const CHUNK = 8 * 1024 * 1024;
    if (isLocalUpload && data.length > CHUNK) {
      const total = data.length;
      for (let offset = 0; offset < total; offset += CHUNK) {
        const chunk = data.subarray(offset, Math.min(offset + CHUNK, total));
        const sep = fullUrl.includes("?") ? "&" : "?";
        const res = await fetch(`${fullUrl}${sep}offset=${offset}&total=${total}`, {
          method: "PUT",
          body: chunk,
          signal,
          headers: { "Content-Type": "application/octet-stream" },
        });
        if (!res.ok) {
          throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
        }
        onProgress((offset + chunk.length) / total);
      }
      return;
    }

    const response = await fetch(fullUrl, {
      method: "PUT",
      body: data,
      signal,
      headers: { "Content-Type": "application/octet-stream" },
    });
    if (!response.ok) {
      throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
    }
    onProgress(1);
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1_048_576).toFixed(1)} MB`;
  }
}
