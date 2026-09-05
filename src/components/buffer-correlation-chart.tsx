import { useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import type { Run, BufferExchangeEvent } from "@/lib/lab-types";

type Props = {
  runs: Run[];
  bufferEvents: BufferExchangeEvent[];
};

type TimelinePoint = {
  date: string;
  timestamp: number;
  runName: string;
  rt: number | null;
  area: number | null;
  fwhm: number | null;
};

/**
 * Shows RT drift, peak area, and FWHM trends over time for runs on a column,
 * with vertical markers at each buffer exchange event.
 */
export function BufferCorrelationChart({ runs, bufferEvents }: Props) {
  // Build timeline data from runs with annotated peaks
  const timelineData = useMemo<TimelinePoint[]>(() => {
    const points: TimelinePoint[] = [];
    for (const run of runs) {
      const annotated = run.peaks.filter((p) => p.analyteId);
      if (annotated.length === 0) continue;
      const ts = new Date(run.acquiredAt).getTime();
      // Use median of annotated peaks for each metric
      const rts = annotated.map((p) => p.rt).sort((a, b) => a - b);
      const areas = annotated.map((p) => p.area).sort((a, b) => a - b);
      const fwhms = annotated.map((p) => p.fwhm).filter((f) => f > 0).sort((a, b) => a - b);
      const mid = (arr: number[]) => arr.length === 0 ? null : arr[Math.floor(arr.length / 2)];
      points.push({
        date: new Date(run.acquiredAt).toLocaleDateString(),
        timestamp: ts,
        runName: run.name,
        rt: mid(rts),
        area: mid(areas),
        fwhm: mid(fwhms),
      });
    }
    return points.sort((a, b) => a.timestamp - b.timestamp);
  }, [runs]);

  // Buffer exchange event timestamps for reference lines
  const eventMarkers = useMemo(() => {
    return bufferEvents
      .map((e) => ({ ts: new Date(e.createdAt).getTime(), label: e.kind }))
      .sort((a, b) => a.ts - b.ts);
  }, [bufferEvents]);

  if (timelineData.length < 2) {
    return (
      <Card className="border-border bg-card p-4">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Buffer change correlation
        </div>
        <h2 className="text-sm font-semibold">RT / area / FWHM timeline</h2>
        <div className="mt-3 flex h-32 items-center justify-center text-xs text-muted-foreground">
          Need at least 2 runs with annotated peaks to show correlation.
        </div>
      </Card>
    );
  }

  // Find the X-axis domain
  const minTs = timelineData[0].timestamp;
  const maxTs = timelineData[timelineData.length - 1].timestamp;
  const padding = (maxTs - minTs) * 0.05;

  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Buffer change correlation
          </div>
          <h2 className="text-sm font-semibold">RT / area / FWHM over time with buffer exchange markers</h2>
        </div>
      </div>

      <div className="mt-3 h-72">
        <ResponsiveContainer>
          <LineChart data={timelineData}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              stroke="var(--muted-foreground)"
              tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
            />
            <YAxis
              yAxisId="rt"
              orientation="left"
              stroke="var(--chart-1)"
              tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              label={{ value: "RT (min)", angle: -90, position: "insideLeft", style: { fontSize: 10, fill: "var(--chart-1)" } }}
            />
            <YAxis
              yAxisId="area"
              orientation="right"
              stroke="var(--chart-2)"
              tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }}
              label={{ value: "Area", angle: 90, position: "insideRight", style: { fontSize: 10, fill: "var(--chart-2)" } }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 11,
              }}
              labelFormatter={(label: any, payload: any) => {
                const p = payload?.[0]?.payload;
                return p ? `${label} — ${p.runName}` : label;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              yAxisId="rt"
              type="monotone"
              dataKey="rt"
              name="Median RT (min)"
              stroke="var(--chart-1)"
              strokeWidth={1.6}
              dot={{ r: 2 }}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              yAxisId="area"
              type="monotone"
              dataKey="area"
              name="Median area"
              stroke="var(--chart-2)"
              strokeWidth={1.6}
              dot={{ r: 2 }}
              isAnimationActive={false}
              connectNulls
            />
            <Line
              yAxisId="rt"
              type="monotone"
              dataKey="fwhm"
              name="Median FWHM (min)"
              stroke="var(--chart-4)"
              strokeWidth={1.2}
              strokeDasharray="3 3"
              dot={{ r: 2 }}
              isAnimationActive={false}
              connectNulls
            />
            {/* Buffer exchange event markers */}
            {eventMarkers.map((ev, i) => {
              // Find the closest timeline point to position the reference line
              const closest = timelineData.reduce((prev, curr) =>
                Math.abs(curr.timestamp - ev.ts) < Math.abs(prev.timestamp - ev.ts) ? curr : prev
              );
              return (
                <ReferenceLine
                  key={`be-${i}`}
                  x={closest.date}
                  stroke="var(--chart-3)"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  label={{ value: "⬇", position: "top", style: { fill: "var(--chart-3)", fontSize: 10 } }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {eventMarkers.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium">Buffer exchange events:</span>
          {eventMarkers.map((ev, i) => (
            <span key={i} className="font-mono">
              {new Date(ev.ts).toLocaleDateString()} ({ev.label})
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}
