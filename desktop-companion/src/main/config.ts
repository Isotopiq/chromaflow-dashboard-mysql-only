// Configuration manager — persists app settings using a simple JSON file.
// Avoids electron-store (ESM-only) so the main process can stay CommonJS.
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type { AppSettings } from "../shared/ipc-types";

const DEFAULT_SETTINGS: AppSettings = {
  apiEndpoint: "http://localhost:29473",
  token: null,
  userEmail: null,
  maxConcurrentUploads: 3,
  defaultStabilizeSeconds: 30,
  defaultMaxRetries: 0,
  notifications: true,
  logLevel: "INFO",
  minimizeToTray: true,
  autoStart: false,
  stayLoggedIn: true,
  forgetProcessedOnDelete: true,
};

export class ConfigManager {
  private settings: AppSettings;
  private settingsPath: string;

  constructor() {
    const userDataPath = app.getPath("userData");
    this.settingsPath = path.join(userDataPath, "settings.json");
    this.settings = { ...DEFAULT_SETTINGS };
    try {
      if (fs.existsSync(this.settingsPath)) {
        const raw = fs.readFileSync(this.settingsPath, "utf-8");
        const parsed = JSON.parse(raw);
        this.settings = { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // If the file is corrupt, use defaults
    }
    this.save();
  }

  private save(): void {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), "utf-8");
    } catch {
      // Ignore write errors
    }
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key];
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value;
    this.save();
  }

  getAll(): AppSettings {
    return { ...this.settings };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...partial };
    this.save();
    return this.getAll();
  }
}
