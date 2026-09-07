// IPC types tests — verify the shared types are correctly structured.
import { describe, it, expect } from "vitest";
import { IPC } from "@shared/ipc-types";

describe("IPC channel names", () => {
  it("should have unique channel names", () => {
    const values = Object.values(IPC);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("should have all required channels", () => {
    expect(IPC.GET_QUEUE).toBeDefined();
    expect(IPC.CANCEL_UPLOAD).toBeDefined();
    expect(IPC.RETRY_UPLOAD).toBeDefined();
    expect(IPC.PAUSE_ALL).toBeDefined();
    expect(IPC.RESUME_ALL).toBeDefined();
    expect(IPC.GET_WATCH_FOLDERS).toBeDefined();
    expect(IPC.ADD_WATCH_FOLDER).toBeDefined();
    expect(IPC.UPDATE_WATCH_FOLDER).toBeDefined();
    expect(IPC.REMOVE_WATCH_FOLDER).toBeDefined();
    expect(IPC.PICK_DIRECTORY).toBeDefined();
    expect(IPC.GET_HISTORY).toBeDefined();
    expect(IPC.EXPORT_HISTORY_CSV).toBeDefined();
    expect(IPC.CLEAR_HISTORY).toBeDefined();
    expect(IPC.GET_SETTINGS).toBeDefined();
    expect(IPC.SAVE_SETTINGS).toBeDefined();
    expect(IPC.TEST_CONNECTION).toBeDefined();
    expect(IPC.LOGIN).toBeDefined();
    expect(IPC.LOGOUT).toBeDefined();
    expect(IPC.GET_AUTH_STATUS).toBeDefined();
    expect(IPC.GET_DASHBOARD_STATS).toBeDefined();
    expect(IPC.GET_HOURLY_UPLOADS).toBeDefined();
    expect(IPC.GET_LAB_DATA).toBeDefined();
    expect(IPC.MINIMIZE).toBeDefined();
    expect(IPC.MAXIMIZE).toBeDefined();
    expect(IPC.CLOSE).toBeDefined();
  });

  it("should have event channels for main→renderer communication", () => {
    expect(IPC.ON_QUEUE_UPDATE).toBeDefined();
    expect(IPC.ON_LOG_ENTRY).toBeDefined();
    expect(IPC.ON_WATCHER_STATUS).toBeDefined();
    expect(IPC.ON_UPLOAD_PROGRESS).toBeDefined();
    expect(IPC.ON_TOAST).toBeDefined();
  });
});
