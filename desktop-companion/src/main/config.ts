// Configuration manager — persists app settings using electron-store.
import Store from "electron-store";
import type { AppSettings } from "@shared/ipc-types";

const DEFAULT_SETTINGS: AppSettings = {
  apiEndpoint: "http://localhost:29473",
  token: null,
  userEmail: null,
  maxConcurrentUploads: 3,
  defaultStabilizeSeconds: 30,
  defaultMaxRetries: 3,
  notifications: true,
  logLevel: "INFO",
  minimizeToTray: true,
  autoStart: false,
};

export class ConfigManager {
  private store: Store;

  constructor() {
    this.store = new Store({
      name: "v3-companion-settings",
      defaults: DEFAULT_SETTINGS as any,
    });
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return (this.store as any).get(key as string) as AppSettings[K];
  }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    (this.store as any).set(key as string, value as any);
  }

  getAll(): AppSettings {
    return { ...DEFAULT_SETTINGS, ...((this.store as any).store as Partial<AppSettings>) };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    for (const [key, value] of Object.entries(partial)) {
      if (value !== undefined) {
        (this.store as any).set(key, value as any);
      }
    }
    return this.getAll();
  }
}
