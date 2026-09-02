import { useState, useMemo } from "react";

type Props = {
  analytes: Array<{ id: string; name: string }>;
  runs: Array<{ id: string; name: string }>;
  matrix: (number | null)[][];
  onCellClick?: (runId: string, analyteId: string) => void;
};

/**
 * Color-coded heatmap grid rendered as an HTML table.
 * Color scale: blue (low) → white → red (high).
 * Includes a log-scale toggle and a legend.
 */
export function BatchHeatmap({ analytes, runs, matrix, onCellClick }: Props) {
  const [logScale, setLogScale] = useState(false);

  // Compute the value range for color scaling (ignoring nulls).
  const { min, max } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const row of matrix) {
      for (const v of row) {
        if (v == null) continue;
        const val = logScale ? Math.log1p(v) : v;
        if (val < lo) lo = val;
        if (val > hi) hi = val;
      }
    }
    if (!isFinite(lo) || !isFinite(hi)) return { min: 0, max: 0 };
    return { min: lo, max: hi };
  }, [matrix, logScale]);

  const range = max - min || 1;

  /**
   * Map a value to a color on the blue → white → red scale.
   * t in [0, 1]: 0 = blue, 0.5 = white, 1 = red.
   */
  function colorFor(v: number | null): string {
    if (v == null) return "#f3f4f6"; // gray for missing
    const val = logScale ? Math.log1p(v) : v;
    const t = Math.max(0, Math.min(1, (val - min) / range));
    if (t < 0.5) {
      // blue → white
      const f = t / 0.5;
      const r = Math.round(255 * f);
      const g = Math.round(255 * f);
      const b = 255;
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // white → red
      const f = (t - 0.5) / 0.5;
      const r = 255;
      const g = Math.round(255 * (1 - f));
      const b = Math.round(255 * (1 - f));
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  function textColorFor(v: number | null): string {
    if (v == null) return "#9ca3af";
    const val = logScale ? Math.log1p(v) : v;
    const t = Math.max(0, Math.min(1, (val - min) / range));
    // Dark text on light backgrounds, white text on dark.
    return t < 0.25 || (t > 0.4 && t < 0.6) ? "#1f2937" : "#ffffff";
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Controls */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setLogScale((s) => !s)}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {logScale ? "Linear scale" : "Log scale"}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {logScale ? "log(1 + area)" : "raw area"}
        </span>
      </div>

      {/* Heatmap table */}
      <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="border-collapse text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-zinc-50 px-2 py-1 text-left font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-300">
                Analyte
              </th>
              {runs.map((run) => (
                <th
                  key={run.id}
                  className="px-2 py-1 font-medium text-zinc-600 dark:text-zinc-300"
                  style={{
                    minWidth: 48,
                    maxWidth: 80,
                  }}
                >
                  <div
                    className="overflow-hidden text-ellipsis whitespace-nowrap"
                    style={{
                      transform: "rotate(-45deg)",
                      transformOrigin: "bottom left",
                      maxWidth: 60,
                    }}
                    title={run.name}
                  >
                    {run.name}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {analytes.map((analyte, ai) => (
              <tr key={analyte.id}>
                <td
                  className="sticky left-0 z-10 bg-zinc-50 px-2 py-1 font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                  title={analyte.name}
                >
                  <div className="max-w-[160px] overflow-hidden text-ellipsis whitespace-nowrap">
                    {analyte.name}
                  </div>
                </td>
                {runs.map((run, ri) => {
                  const v = matrix[ri]?.[ai] ?? null;
                  const bg = colorFor(v);
                  const fg = textColorFor(v);
                  return (
                    <td
                      key={run.id}
                      className="border border-zinc-100 p-0 dark:border-zinc-800"
                    >
                      <button
                        type="button"
                        onClick={() => onCellClick?.(run.id, analyte.id)}
                        className="flex h-9 w-full min-w-[48px] items-center justify-center text-center transition-opacity hover:opacity-80"
                        style={{ backgroundColor: bg, color: fg }}
                        title={
                          v != null
                            ? `${analyte.name} / ${run.name}: ${v.toLocaleString()}`
                            : `${analyte.name} / ${run.name}: not detected`
                        }
                      >
                        {v != null ? formatValue(v) : "—"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>Low</span>
        <div
          className="h-3 w-40 rounded"
          style={{
            background:
              "linear-gradient(to right, rgb(0,0,255), rgb(255,255,255), rgb(255,0,0))",
          }}
        />
        <span>High</span>
        <span className="ml-2">
          ({min.toLocaleString()} – {max.toLocaleString()})
        </span>
      </div>
    </div>
  );
}

function formatValue(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  if (v >= 100) return v.toFixed(0);
  if (v >= 1) return v.toFixed(1);
  return v.toFixed(2);
}
