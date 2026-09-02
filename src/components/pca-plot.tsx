import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  Label,
  ReferenceLine,
} from "recharts";
import type { PCAResult } from "@/lib/pca-math";

type Props = {
  result: PCAResult;
};

type ScorePoint = {
  pc1: number;
  pc2: number;
  pc3: number;
  label: string;
  runId: string;
};

type LoadingPoint = {
  pc1: number;
  pc2: number;
  name: string;
  analyteId: string;
};

/**
 * PCA scatter plot: PC1 vs PC2 with run labels.
 * Includes a toggle to show the loadings plot (which analytes drive separation).
 */
export function PcaPlot({ result }: Props) {
  const [showLoadings, setShowLoadings] = useState(false);

  const scores: ScorePoint[] = useMemo(
    () =>
      result.scores.map((s) => ({
        pc1: s.pc1,
        pc2: s.pc2,
        pc3: s.pc3,
        label: s.label,
        runId: s.runId,
      })),
    [result],
  );

  const loadings: LoadingPoint[] = useMemo(
    () =>
      result.loadings.map((l) => ({
        pc1: l.pc1,
        pc2: l.pc2,
        name: l.name,
        analyteId: l.analyteId,
      })),
    [result],
  );

  const ev = result.explainedVariance;
  const pc1Pct = ev[0] != null ? ev[0].toFixed(1) : "0";
  const pc2Pct = ev[1] != null ? ev[1].toFixed(1) : "0";

  if (scores.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        Not enough runs for PCA (need at least 2).
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Toggle */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setShowLoadings((s) => !s)}
          className="rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {showLoadings ? "Show scores" : "Show loadings"}
        </button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {showLoadings
            ? "Loadings: which analytes drive separation along PC1/PC2"
            : "Scores: projection of each run onto PC1/PC2"}
        </span>
      </div>

      {/* Plot */}
      <div style={{ width: "100%", height: 400 }}>
        <ResponsiveContainer>
          <ScatterChart
            margin={{ top: 20, right: 30, bottom: 50, left: 50 }}
          >
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              type="number"
              dataKey="pc1"
              name="PC1"
              tick={{ fontSize: 11 }}
            >
              <Label
                value={`PC1 (${pc1Pct}% variance)`}
                position="bottom"
                offset={10}
                fontSize={12}
              />
            </XAxis>
            <YAxis
              type="number"
              dataKey="pc2"
              name="PC2"
              tick={{ fontSize: 11 }}
            >
              <Label
                value={`PC2 (${pc2Pct}% variance)`}
                angle={-90}
                position="left"
                offset={10}
                fontSize={12}
              />
            </YAxis>
            <ZAxis range={[60, 60]} />
            <ReferenceLine x={0} stroke="#9ca3af" strokeDasharray="3 3" />
            <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={<PcaTooltip mode={showLoadings ? "loadings" : "scores"} />}
            />
            {showLoadings ? (
              <Scatter
                name="Loadings"
                data={loadings}
                fill="#ef4444"
                fillOpacity={0.6}
              />
            ) : (
              <Scatter
                name="Scores"
                data={scores}
                fill="#3b82f6"
                fillOpacity={0.7}
              />
            )}
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {/* Run labels list (for scores mode) */}
      {!showLoadings && (
        <div className="flex flex-wrap gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          {scores.map((s) => (
            <span
              key={s.runId}
              className="rounded bg-blue-50 px-2 py-0.5 dark:bg-blue-950/40"
              title={`PC1=${s.pc1.toFixed(3)}, PC2=${s.pc2.toFixed(3)}, PC3=${s.pc3.toFixed(3)}`}
            >
              {s.label}
            </span>
          ))}
        </div>
      )}

      {/* Top loadings list */}
      {showLoadings && loadings.length > 0 && (
        <div className="text-xs text-zinc-600 dark:text-zinc-300">
          <p className="mb-1 font-medium">Top analytes by |PC1| loading:</p>
          <div className="flex flex-wrap gap-2">
            {[...loadings]
              .sort((a, b) => Math.abs(b.pc1) - Math.abs(a.pc1))
              .slice(0, 10)
              .map((l) => (
                <span
                  key={l.analyteId}
                  className="rounded bg-red-50 px-2 py-0.5 dark:bg-red-950/40"
                  title={`PC1=${l.pc1.toFixed(4)}, PC2=${l.pc2.toFixed(4)}`}
                >
                  {l.name} ({l.pc1.toFixed(3)})
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Custom tooltip ----
function PcaTooltip({
  active,
  payload,
  mode,
}: {
  active?: boolean;
  payload?: Array<{ payload: ScorePoint | LoadingPoint }>;
  mode: "scores" | "loadings";
}) {
  if (!active || !payload || payload.length === 0) return null;
  const p = payload[0].payload;
  if (mode === "loadings") {
    const lp = p as LoadingPoint;
    return (
      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        <p className="font-medium">{lp.name}</p>
        <p className="text-zinc-500">PC1: {lp.pc1.toFixed(4)}</p>
        <p className="text-zinc-500">PC2: {lp.pc2.toFixed(4)}</p>
      </div>
    );
  }
  const sp = p as ScorePoint;
  return (
    <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <p className="font-medium">{sp.label}</p>
      <p className="text-zinc-500">PC1: {sp.pc1.toFixed(3)}</p>
      <p className="text-zinc-500">PC2: {sp.pc2.toFixed(3)}</p>
      <p className="text-zinc-500">PC3: {sp.pc3.toFixed(3)}</p>
    </div>
  );
}
