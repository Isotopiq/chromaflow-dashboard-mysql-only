import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceDot,
  ReferenceArea,
  ReferenceLine,
  Legend,
} from "recharts";
import { useState } from "react";
import type { Run, Peak } from "@/lib/lab-types";

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
  /** When set, draw a shaded vertical band between these RT values. */
  selectionBand?: { x1: number; x2: number } | null;
  /** Optional dotted baseline points across the band. */
  baseline?: { x1: number; y1: number; x2: number; y2: number } | null;
  /** Enable click-drag selection. Receives the selected [x1, x2]. */
  onSelectRange?: (x1: number, x2: number) => void;
};

export function ChromatogramPlot({
  runs,
  height = 320,
  showPeaks = false,
  channel = "tic",
  compact = false,
  selectionBand = null,
  baseline = null,
  onSelectRange,
}: Props) {
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [dragEnd, setDragEnd] = useState<number | null>(null);
  if (runs.length === 0) return null;

  // Each run carries its own x/y dataset — Line accepts its own `data` prop,
  // so overlay no longer assumes all runs share the first run's x-axis.
  const series = runs.map((r) => {
    const xs = r.trace?.x ?? [];
    const ys = r.trace?.[channel] ?? [];
    const data = xs.map((t, i) => ({ time: t, value: ys[i] ?? 0 }));
    return { run: r, data };
  });

  const hasAnyPoint = series.some((s) => s.data.length > 0);
  if (!hasAnyPoint) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
      >
        No chromatogram data
      </div>
    );
  }

  const baseX = series[0].data.map((d) => d.time);
  const peakRefs = showPeaks
    ? (runs[0].peaks ?? []).map((p) => {
        const closestIdx = baseX.findIndex((t) => t >= p.rt);
        const yVal = series[0].data[closestIdx >= 0 ? closestIdx : 0]?.value ?? 0;
        return { p, yVal };
      })
    : [];

  return (
    <div style={{ width: "100%", height, cursor: onSelectRange ? "crosshair" : undefined }}>
      <ResponsiveContainer>
        <LineChart
          margin={{ top: 8, right: 12, left: compact ? -16 : 0, bottom: 0 }}
          onMouseDown={(e: any) => {
            if (!onSelectRange) return;
            if (e?.activeLabel == null) return;
            setDragStart(Number(e.activeLabel));
            setDragEnd(Number(e.activeLabel));
          }}
          onMouseMove={(e: any) => {
            if (!onSelectRange || dragStart == null) return;
            if (e?.activeLabel == null) return;
            setDragEnd(Number(e.activeLabel));
          }}
          onMouseUp={() => {
            if (!onSelectRange) return;
            if (dragStart != null && dragEnd != null && dragStart !== dragEnd) {
              onSelectRange(
                Math.min(dragStart, dragEnd),
                Math.max(dragStart, dragEnd),
              );
            }
            setDragStart(null);
            setDragEnd(null);
          }}
          onMouseLeave={() => {
            setDragStart(null);
            setDragEnd(null);
          }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={["dataMin", "dataMax"]}
            allowDuplicatedCategory={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}`}
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
            tickFormatter={(v: number) => {
              if (!Number.isFinite(v)) return "";
              if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
              if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
              return `${v.toFixed(0)}`;
            }}
            width={compact ? 32 : 52}
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
              labelFormatter={(v: number) => `RT ${Number(v).toFixed(2)} min`}
              formatter={(v: number, name: string) => [
                Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }),
                name,
              ]}
            />
          )}
          {runs.length > 1 && !compact && (
            <Legend wrapperStyle={{ fontSize: 10, fontFamily: "var(--font-mono)" }} />
          )}
          {series.map(({ run, data }, idx) => (
            <Line
              key={run.id}
              data={data}
              type="monotone"
              dataKey="value"
              stroke={TRACE_COLORS[idx % TRACE_COLORS.length]}
              strokeWidth={1.4}
              dot={false}
              isAnimationActive={false}
              name={run.name}
            />
          ))}
          {peakRefs.map(({ p, yVal }) => (
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
          ))}
          {selectionBand && (
            <ReferenceArea
              x1={selectionBand.x1}
              x2={selectionBand.x2}
              fill="var(--primary)"
              fillOpacity={0.12}
              stroke="var(--primary)"
              strokeOpacity={0.4}
            />
          )}
          {dragStart != null && dragEnd != null && dragStart !== dragEnd && (
            <ReferenceArea
              x1={Math.min(dragStart, dragEnd)}
              x2={Math.max(dragStart, dragEnd)}
              fill="var(--primary)"
              fillOpacity={0.18}
            />
          )}
          {baseline && (
            <ReferenceLine
              segment={[
                { x: baseline.x1, y: baseline.y1 },
                { x: baseline.x2, y: baseline.y2 },
              ]}
              stroke="var(--peak-annotated)"
              strokeDasharray="3 3"
              ifOverflow="extendDomain"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
