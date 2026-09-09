// V3 REST API client — calls the /api/desktop/* endpoints on the V3 web app.
// Uses bearer token authentication.
import type { ConfigManager } from "./config";
import type { LocalDb } from "./db";
import type { LabData, WatchFolder } from "../shared/ipc-types";

export class ApiClient {
  private config: ConfigManager;
  private db: LocalDb;

  constructor(config: ConfigManager, db: LocalDb) {
    this.config = config;
    this.db = db;
  }

  private getBaseUrl(): string {
    return this.config.get("apiEndpoint").replace(/\/+$/, "");
  }

  private getToken(): string | null {
    return this.config.get("token");
  }

  private authHeaders(): Record<string, string> {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    requireAuth = true,
  ): Promise<T> {
    const url = `${this.getBaseUrl()}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(requireAuth ? this.authHeaders() : {}),
    };
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      const msg = (err as any)?.error ?? `HTTP ${res.status}`;
      const details = (err as any)?.details;
      // Clear the stored token on 401 so the app shows as logged out —
      // the JWT may outlive the user row after a DB reset/recreation.
      if (res.status === 401) {
        this.config.set("token", null);
        this.config.set("userEmail", null);
        this.db.log("WARN", "Session expired or user no longer exists — please sign in again in Settings");
      }
      throw new Error(details ? `${msg}: ${JSON.stringify(details).slice(0, 500)}` : msg);
    }
    return res.json() as Promise<T>;
  }

  // ---- Auth ----
  async login(email: string, password: string): Promise<{ token: string; user: { id: string; email: string } }> {
    const result = await this.request<{ token: string; user: { id: string; email: string } }>(
      "POST", "/api/desktop/login", { email, password }, false,
    );
    this.config.set("token", result.token);
    this.config.set("userEmail", result.user.email);
    return result;
  }

  logout() {
    this.config.set("token", null);
    this.config.set("userEmail", null);
  }

  isAuthenticated(): boolean {
    return !!this.getToken();
  }

  // ---- Health ----
  async health(): Promise<{ ok: boolean; version: string }> {
    return this.request("GET", "/api/desktop/health", undefined, false);
  }

  async testConnection(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      await this.health();
      return { ok: true, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }

  // ---- Upload URLs ----
  async getUploadUrl(params: {
    filename: string;
    bucket?: string;
    suffix?: string;
    contentType?: string;
  }): Promise<{ signedUrl: string; path: string; bucket: string }> {
    return this.request("POST", "/api/desktop/upload-url", params);
  }

  // ---- Runs ----
  async createRun(data: any): Promise<{ run: any }> {
    return this.request("POST", "/api/desktop/create-run", data);
  }

  async findRunByPath(filePath: string): Promise<{ run: any | null }> {
    return this.request("POST", "/api/desktop/find-run", { filePath });
  }

  // ---- Watch Folders ----
  async listWatchFolders(): Promise<WatchFolder[]> {
    return this.request("GET", "/api/desktop/watch-folders");
  }

  async upsertWatchFolder(folder: {
    id?: string;
    path: string;
    enabled: boolean;
    methodId?: string | null;
    columnId?: string | null;
    batchId?: string | null;
    filePattern?: string;
  }): Promise<WatchFolder> {
    return this.request("POST", "/api/desktop/watch-folders", folder);
  }

  async deleteWatchFolder(id: string): Promise<{ ok: boolean }> {
    return this.request("DELETE", `/api/desktop/watch-folders/${id}`);
  }

  // ---- Lab Data ----
  async getLabData(): Promise<LabData> {
    return this.request("GET", "/api/desktop/lab-data");
  }
}
