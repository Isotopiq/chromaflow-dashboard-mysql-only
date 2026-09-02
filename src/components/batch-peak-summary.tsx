import { useState, useMemo } from "react";

type Props = {
  runs: Array<{ id: string; name: string; peakCount: number }>;
  analyteCoverage: Array<{
    id: string;
    name: string;
    foundInRuns: number;
    totalRuns: number;
  }>;
};

type SortKey = "name" | "coverage" | "found";

/**
 * Batch peak-picking summary: shows per-analyte coverage across runs
 * and per-run peak counts. The analyte table is sortable by coverage.
 */
export function BatchPeakSummary({ runs, analyteCoverage }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("coverage");
  const [sortAsc, setSortAsc] = useState(false);

  const sortedCoverage = useMemo(() => {
    const arr = [...analyteCoverage];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "coverage":
          cmp = a.totalRuns > 0
            ? a.foundInRuns / a.totalRuns - b.foundInRuns / b.totalRuns
            : a.foundInRuns - b.foundInRuns;
          break;
        case "found":
          cmp = a.foundInRuns - b.foundInRuns;
          break;
      }
      return sortAsc ? cmp : -cmp;
    });
    return arr;
  }, [analyteCoverage, sortKey, sortAsc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((a) => !a);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const totalRuns = runs.length;
  const totalPeaks = runs.reduce((s, r) => s + r.peakCount, 0);
  const avgPeaks = totalRuns > 0 ? totalPeaks / totalRuns : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Runs" value={totalRuns.toString()} />
        <StatCard label="Total peaks" value={totalPeaks.toLocaleString()} />
        <StatCard label="Avg peaks/run" value={avgPeaks.toFixed(1)} />
      </div>

      {/* Per-run peak counts */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Peaks per run
        </h4>
        <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-300">
                  Run
                </th>
                <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-300">
                  Peaks
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-200">
                    {run.name}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                    {run.peakCount.toLocaleString()}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td
                    colSpan={2}
                    className="px-3 py-4 text-center text-zinc-400"
                  >
                    No runs in this batch.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Analyte coverage table */}
      <div>
        <h4 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          Analyte coverage
        </h4>
        <div className="overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <SortHeader
                  label="Analyte"
                  active={sortKey === "name"}
                  asc={sortAsc}
                  onClick={() => toggleSort("name")}
                />
                <SortHeader
                  label="Found"
                  active={sortKey === "found"}
                  asc={sortAsc}
                  onClick={() => toggleSort("found")}
                  align="right"
                />
                <SortHeader
                  label="Coverage"
                  active={sortKey === "coverage"}
                  asc={sortAsc}
                  onClick={() => toggleSort("coverage")}
                  align="right"
                />
              </tr>
            </thead>
            <tbody>
              {sortedCoverage.map((a) => {
                const pct =
                  a.totalRuns > 0 ? (a.foundInRuns / a.totalRuns) * 100 : 0;
                return (
                  <tr
                    key={a.id}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-200">
                      {a.name}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-zinc-700 dark:text-zinc-200">
                      {a.foundInRuns}/{a.totalRuns}
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                          <div
                            className="h-full rounded-full bg-blue-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-12 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedCoverage.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="px-3 py-4 text-center text-zinc-400"
                  >
                    No analyte coverage data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-components ----

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">
        {value}
      </p>
    </div>
  );
}

function SortHeader({
  label,
  active,
  asc,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  asc: boolean;
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 font-medium text-zinc-600 dark:text-zinc-300 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100"
      >
        {label}
        {active && <span>{asc ? " ▲" : " ▼"}</span>}
      </button>
    </th>
  );
}
