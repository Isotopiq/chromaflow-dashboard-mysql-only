/** @vitest-environment happy-dom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useResizableColumns, ResizableTh } from "../src/renderer/components/ui";
import { Docs } from "../src/renderer/views/Docs";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mouseDown(el: Element, x: number) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: x }));
}
function mouseMove(x: number) {
  document.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x }));
}
function mouseUp(x: number) {
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: x }));
}

// ─── Probe component exposing the hook ───────────────────────────────────────
function Probe({
  storageKey = "test-widths",
  defaults = [32, 200, 100],
}: {
  storageKey?: string;
  defaults?: number[];
}) {
  const { widths, startDrag, reset } = useResizableColumns(storageKey, defaults);
  return (
    <div>
      <table>
        <colgroup>
          {widths.map((w, i) => (
            <col key={i} data-w={w} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <ResizableTh label="B" index={1} startDrag={startDrag} />
            <ResizableTh label="C" index={2} startDrag={startDrag} />
          </tr>
        </thead>
      </table>
      <div id="w1">{widths[1]}</div>
      <button id="reset" onClick={reset} />
    </div>
  );
}

describe("useResizableColumns", () => {
  it("renders defaults and drags a column wider", () => {
    act(() => root.render(<Probe />));
    expect(container.querySelector("#w1")!.textContent).toBe("200");

    const handle = container.querySelector("th span")!;
    act(() => mouseDown(handle, 100));
    act(() => mouseMove(160));
    expect(container.querySelector("#w1")!.textContent).toBe("260");
    act(() => mouseUp(160));

    const col = container.querySelectorAll("col")[1]!;
    expect(col.getAttribute("data-w")).toBe("260");
  });

  it("clamps at the minimum width", () => {
    act(() => root.render(<Probe />));
    const handle = container.querySelector("th span")!;
    act(() => mouseDown(handle, 300));
    act(() => mouseMove(0)); // drag far left
    expect(container.querySelector("#w1")!.textContent).toBe("48");
    act(() => mouseUp(0));
  });

  it("stops resizing after mouseup", () => {
    act(() => root.render(<Probe />));
    const handle = container.querySelector("th span")!;
    act(() => mouseDown(handle, 100));
    act(() => mouseMove(150));
    act(() => mouseUp(150));
    act(() => mouseMove(400)); // should be ignored
    expect(container.querySelector("#w1")!.textContent).toBe("250");
  });

  it("resizes only the dragged column", () => {
    act(() => root.render(<Probe />));
    const handle = container.querySelectorAll("th span")[1]!; // column C (index 2)
    act(() => mouseDown(handle, 100));
    act(() => mouseMove(130));
    act(() => mouseUp(130));
    const cols = container.querySelectorAll("col");
    expect(cols[1].getAttribute("data-w")).toBe("200"); // untouched
    expect(cols[2].getAttribute("data-w")).toBe("130");
  });

  it("persists widths to localStorage and reloads them", () => {
    act(() => root.render(<Probe />));
    const handle = container.querySelector("th span")!;
    act(() => mouseDown(handle, 100));
    act(() => mouseMove(140));
    act(() => mouseUp(140));

    const stored = JSON.parse(localStorage.getItem("test-widths")!);
    expect(stored).toEqual([32, 240, 100]);

    // Remount — should restore persisted widths
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<Probe />));
    expect(container.querySelector("#w1")!.textContent).toBe("240");
  });

  it("falls back to defaults on corrupted localStorage", () => {
    localStorage.setItem("test-widths", "{not json");
    act(() => root.render(<Probe />));
    expect(container.querySelector("#w1")!.textContent).toBe("200");

    localStorage.setItem("test-widths", JSON.stringify([32])); // wrong length
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<Probe />));
    expect(container.querySelector("#w1")!.textContent).toBe("200");
  });

  it("reset restores defaults", () => {
    act(() => root.render(<Probe />));
    const handle = container.querySelector("th span")!;
    act(() => mouseDown(handle, 100));
    act(() => mouseMove(200));
    act(() => mouseUp(200));
    act(() => (container.querySelector("#reset") as HTMLButtonElement).click());
    expect(container.querySelector("#w1")!.textContent).toBe("200");
    expect(JSON.parse(localStorage.getItem("test-widths")!)).toEqual([32, 200, 100]);
  });

  it("supports a second drag after the first completes", () => {
    act(() => root.render(<Probe />));
    const handle = container.querySelector("th span")!;
    act(() => mouseDown(handle, 100));
    act(() => mouseMove(120));
    act(() => mouseUp(120));
    act(() => mouseDown(handle, 50));
    act(() => mouseMove(80));
    act(() => mouseUp(80));
    expect(container.querySelector("#w1")!.textContent).toBe("250");
  });
});

// ─── Documentation view ──────────────────────────────────────────────────────
describe("Docs view", () => {
  it("auto-loads the first section without any network/desktop API", () => {
    act(() => root.render(<Docs />));
    expect(container.querySelector("h1")!.textContent).toBe("Getting started");
    // All 9 topics listed in the nav
    expect(container.querySelectorAll("nav button").length).toBe(9);
  });

  it("switches sections via the topic nav", () => {
    act(() => root.render(<Docs />));
    const navBtns = Array.from(container.querySelectorAll("nav button"));
    const trouble = navBtns.find((b) => b.textContent === "Troubleshooting")!;
    act(() => (trouble as HTMLButtonElement).click());
    expect(container.querySelector("h1")!.textContent).toBe("Troubleshooting");
    expect(container.textContent).toContain("Files not detected");
  });

  it("filters topics with the search box", () => {
    act(() => root.render(<Docs />));
    const input = (container.querySelector("nav input") ??
      container.querySelector("input")!) as HTMLInputElement;
    act(() => {
      // React's onChange tracks value via the prototype setter — use it so
      // the synthetic event sees a real change.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value",
      )!.set!;
      setter.call(input, "queue");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React's onChange listens to 'input' natively — ensure filter applied
    const labels = Array.from(container.querySelectorAll("nav button")).map((b) => b.textContent);
    expect(labels).toContain("Upload queue");
    expect(labels).not.toContain("Troubleshooting");
  });

  it("walks sections with prev/next buttons", () => {
    act(() => root.render(<Docs />));
    const next = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Connecting to ChromaFlow"),
    )!;
    act(() => (next as HTMLButtonElement).click());
    expect(container.querySelector("h1")!.textContent).toBe("Connecting to ChromaFlow");
  });
});
