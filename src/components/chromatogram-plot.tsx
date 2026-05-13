import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
  Legend,
} from "recharts";
import type { Run, Peak } from "@/lib/mock-data";

const TRACE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

type Props = {
  runs: Array<{ id: string; name: string; trace: Run["trace"]; peaks?: Peak[] }>;
  height?: number;
  showPeaks?: boolean;
  channel?: "tic" | "bpc";
  compact?: boolean;
};

export function ChromatogramPlot({
  runs,
  height = 320,
  showPeaks = false,
  channel = "tic",
  compact = false,
}: Props) {
  // Build merged dataset for recharts: x as 'time', and series as r0, r1...
  if (runs.length === 0) return null;
  const baseX = runs[0].trace.x;
  const data = baseX.map((t, i) => {
    const row: Record<string, number> = { time: t };
    runs.forEach((r, idx) => {
      const v = r.trace[channel][i];
      if (v !== undefined) row[`r${idx}`] = v;
    });
    return row;
  });

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, left: compact ? -16 : 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => `${v.toFixed(1)}`}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            label={
              compact
                ? undefined
                : { value: "Retention time (min)", position: "insideBottom", offset: -2, fontSize: 10, fill: "var(--muted-foreground)" }
            }
          />
          <YAxis
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            width={compact ? 28 : 48}
          />
          {!compact && (
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
              }}
              labelFormatter={(v: number) => `RT ${v.toFixed(2)} min`}
              formatter={(v: number, _n, item) => {
                const idx = parseInt(String(item.dataKey).replace("r", ""), 10);
                return [v.toLocaleString(undefined, { maximumFractionDigits: 0 }), runs[idx]?.name];
              }}
            />
          )}
          {runs.length > 1 && !compact && (
            <Legend
              wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              formatter={(_v, _e, idx) => runs[idx as number]?.name ?? ""}
            />
          )}
          {runs.map((r, idx) => (
            <Line
              key={r.id}
              type="monotone"
              dataKey={`r${idx}`}
              stroke={TRACE_COLORS[idx % TRACE_COLORS.length]}
              strokeWidth={1.4}
              dot={false}
              isAnimationActive={false}
              name={r.name}
            />
          ))}
          {showPeaks &&
            runs[0].peaks?.map((p) => {
              const closestIdx = baseX.findIndex((t) => t >= p.rt);
              const yVal = data[closestIdx]?.r0 ?? 0;
              return (
                <ReferenceDot
                  key={p.id}
                  x={p.rt}
                  y={yVal}
                  r={3}
                  fill={p.analyteName ? "var(--peak-annotated)" : "var(--peak)"}
                  stroke="var(--background)"
                  strokeWidth={1}
                  isFront
                />
              );
            })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
