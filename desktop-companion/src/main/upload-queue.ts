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
import type { QueueItem, UploadStatus } from "../shared/ipc-types";

export class UploadQueue extends EventEmitter {
  private db: LocalDb;
  private api: ApiClient;
  private config: ConfigManager;
  private queue: QueueItem[] = [];
  private active: Map<string, AbortController> = new Map();
  private processing = false;

  constructor(db: LocalDb, api: ApiClient, config: ConfigManager) {
    super();
    this.db = db;
    this.api = api;
    this.config = config;

    // Load persisted queue items on startup
    this.queue = this.db.getQueueItems();
  }

  start() {
    this.processing = true;
    this.processNext();
  }

  enqueue(filePath: string, folderId: string, size: number) {
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
    const item = this.queue.find((q) => q.id === id);
    if (item) {
      item.status = "cancelled";
      item.error = "Cancelled by user";
      this.db.saveQueueItem(item);
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

  private async processNext() {
    if (!this.processing) return;

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
    } catch (err: any) {
      if ((next.status as string) === "cancelled") {
        // Already handled
      } else {
        next.status = "failed";
        next.error = err?.message ?? "Upload failed";
        this.db.saveQueueItem(next);
        this.db.log("ERROR", `Upload failed: ${next.filename} — ${next.error}`);

        // Auto-retry with exponential backoff
        const maxRetries = this.config.get("defaultMaxRetries");
        if (next.retries < maxRetries) {
          next.retries++;
          const delay = Math.min(1000 * 2 ** next.retries, 30_000);
          this.db.log("WARN", `Retry ${next.retries}/${maxRetries} for ${next.filename} in ${delay / 1000}s`);
          setTimeout(() => {
            if (next.status === "failed") {
              next.status = "queued";
              next.error = null;
              this.db.saveQueueItem(next);
              this.emit("queue-update", this.getQueue());
              this.processNext();
            }
          }, delay);
        }
      }
    } finally {
      this.active.delete(next.id);
      this.emit("queue-update", this.getQueue());
      this.processNext();
    }
  }

  private async processItem(item: QueueItem, signal: AbortSignal) {
    // 1. Parse the file in a worker thread
    item.status = "parsing";
    this.emit("progress", item);

    const parsed = await this.parseFile(item.filePath);

    // 2. Compute SHA-256 hash
    const hash = await this.computeHash(item.filePath);

    // 3. Check for duplicates
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

    // 8. Create run
    item.progress = 95;
    this.emit("progress", item);

    const runResult = await this.api.createRun({
      name: item.filename.replace(/\.(mzXML|mzML)$/i, ""),
      filePath: item.filePath,
      scansBlobPath: scansUrl.path,
      fileFormat: parsed.summary.format,
      fileSize: this.formatSize(item.size),
      ionMode: parsed.summary.ionMode,
      msLevel: parsed.summary.msLevel,
      trace: parsed.summary.trace,
      peaks: parsed.summary.peaks,
    });

    // 9. Record in history
    this.db.addHistory({
      filename: item.filename,
      sourceDir: path.dirname(item.filePath),
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

  private async parseFile(filePath: string): Promise<{
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
      const workerPath = path.join(__dirname, "parser-worker.js");
      const worker = new Worker(workerPath, { workerData: filePath });

      worker.on("message", (msg: any) => {
        if (msg.ok) {
          resolve(msg);
        } else {
          reject(new Error(msg.error || "Parse failed"));
        }
        worker.terminate();
      });

      worker.on("error", (err) => {
        reject(err);
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        worker.terminate();
        reject(new Error("Parse timeout (5 min)"));
      }, 5 * 60 * 1000);
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
    const response = await fetch(url, {
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
