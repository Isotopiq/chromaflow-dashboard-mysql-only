/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { HistoryEntry } from "../src/shared/ipc-types";
import { History } from "../src/renderer/views/History";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRIES: HistoryEntry[] = [
  {
    id: 1, filename: "sample-001.mzXML", sourceDir: "C:\\Data\\Run1",
    filePath: "C:\\Data\\Run1\\sample-001.mzXML", uploadedAt: Date.now() - 60_000,
    size: 4_200_000, durationMs: 3200, status: "done",
    sha256: "ab".repeat(32), runId: "r1", v3FolderId: null,
  },
  {
    id: 2, filename: "blank.mzML", sourceDir: "D:\\Instrument\\out",
    filePath: "D:\\Instrument\\out\\blank.mzML", uploadedAt: Date.now() - 3_600_000,
    size: 900_000, durationMs: 800, status: "failed", sha256: null,
    runId: null, v3FolderId: null,
  },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  (window as any).desktop = {
    getHistory: async () => ({ entries: ENTRIES, total: ENTRIES.length }),
    saveHistoryCsv: async () => {},
    deleteHistoryItems: async () => {},
    reuploadHistoryItem: async () => ({ ok: true }),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function renderHistory() {
  await act(async () => { root.render(<History />); });
  // flush the getHistory promise
  await act(async () => { await Promise.resolve(); });
}

describe("History view — resizable columns (integration)", () => {
  it("renders rows from the desktop API", async () => {
    await renderHistory();
    expect(container.textContent).toContain("sample-001.mzXML");
    expect(container.textContent).toContain("blank.mzML");
    expect(container.textContent).toContain("2"); // total badge
  });

  it("every labeled header has a drag handle; checkbox column does not", async () => {
    await renderHistory();
    const ths = container.querySelectorAll("thead th");
    expect(ths.length).toBe(9); // checkbox + 8 columns
    const handles = container.querySelectorAll("thead th span[title='Drag to resize']");
    expect(handles.length).toBe(8);
  });

  it("dragging the Filename header edge widens the column", async () => {
    await renderHistory();
    const handles = container.querySelectorAll("thead th span[title='Drag to resize']");
    const handle = handles[0]; // Filename → col index 1
    const before = container.querySelectorAll("col")[1].getAttribute("style");

    act(() => {
      handle.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 160 }));
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 160 }));
    });

    const after = container.querySelectorAll("col")[1].getAttribute("style");
    expect(after).not.toBe(before);
    expect(after).toContain("300px"); // 240 + 60

    // persisted under the history key
    expect(JSON.parse(localStorage.getItem("history-col-widths")!)[1]).toBe(300);
  });

  it("reset widths button restores defaults", async () => {
    await renderHistory();
    const handles = container.querySelectorAll("thead th span[title='Drag to resize']");
    act(() => {
      handles[2].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 100 }));
      document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 300 }));
      document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: 300 }));
    });
    const resetBtn = Array.from(container.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("Reset widths"))!;
    act(() => (resetBtn as HTMLButtonElement).click());
    expect(container.querySelectorAll("col")[3].getAttribute("style")).toContain("140px");
  });

  it("handles a missing desktop API without crashing", async () => {
    (window as any).desktop = undefined;
    await renderHistory();
    expect(container.textContent).toContain("No history entries");
  });
});
