// Excel export helpers using exceljs.
// Generates .xlsx workbooks for peak tables, batch summary heatmaps, and
// quantitation results.

import ExcelJS from "exceljs";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Style constants for header rows. */
const HEADER_FILL: Partial<ExcelJS.Fill> = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF4472C4" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

/** Apply bold + fill to a header row and freeze the first row. */
function styleHeaderRow(sheet: ExcelJS.Worksheet, colCount: number) {
  const header = sheet.getRow(1);
  for (let c = 1; c <= colCount; c++) {
    const cell = header.getCell(c);
    cell.font = HEADER_FONT as ExcelJS.Font;
    cell.fill = HEADER_FILL as ExcelJS.Fill;
    cell.alignment = { vertical: "middle", horizontal: "center" };
  }
  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

/** Auto-size columns based on the widest cell content in each column. */
function autoSizeColumns(
  sheet: ExcelJS.Worksheet,
  colCount: number,
  rowCount: number,
) {
  for (let c = 1; c <= colCount; c++) {
    let maxLen = 0;
    for (let r = 1; r <= rowCount; r++) {
      const cell = sheet.getRow(r).getCell(c);
      const val = cell.value;
      const text =
        val === null || val === undefined
          ? ""
          : typeof val === "object" && "text" in val
            ? String((val as { text: unknown }).text)
            : String(val);
      if (text.length > maxLen) maxLen = text.length;
    }
    // Cap width to keep things readable
    sheet.getColumn(c).width = Math.min(Math.max(maxLen + 2, 8), 60);
  }
}

/**
 * Generate an .xlsx peak table workbook from one or more runs.
 *
 * Sheet 1 "Summary": run name, peak count, annotated count.
 * Sheet 2 "Peak Table": all peaks from all runs with columns:
 *   Run, Analyte, RT, m/z, Area, Height, FWHM, S/N, Notes.
 */
export async function exportPeakTableXlsx(
  runs: Array<{
    name: string;
    peaks: Array<{
      rt: number;
      area: number;
      height: number;
      fwhm: number;
      sn: number;
      mz?: number;
      analyteName?: string;
      notes?: string;
    }>;
  }>,
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ChromaFlow";
  workbook.created = new Date();

  // ---- Sheet 1: Summary ----
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Run", key: "name", width: 32 },
    { header: "Peak Count", key: "peakCount", width: 14 },
    { header: "Annotated Count", key: "annotatedCount", width: 18 },
  ];
  styleHeaderRow(summary, 3);

  for (const run of runs) {
    const annotated = run.peaks.filter((p) => !!p.analyteName).length;
    summary.addRow({
      name: run.name,
      peakCount: run.peaks.length,
      annotatedCount: annotated,
    });
  }
  autoSizeColumns(summary, 3, runs.length + 1);

  // ---- Sheet 2: Peak Table ----
  const peakSheet = workbook.addWorksheet("Peak Table");
  peakSheet.columns = [
    { header: "Run", key: "run" },
    { header: "Analyte", key: "analyte" },
    { header: "RT", key: "rt" },
    { header: "m/z", key: "mz" },
    { header: "Area", key: "area" },
    { header: "Height", key: "height" },
    { header: "FWHM", key: "fwhm" },
    { header: "S/N", key: "sn" },
    { header: "Notes", key: "notes" },
  ];
  styleHeaderRow(peakSheet, 9);

  let totalRows = 1;
  for (const run of runs) {
    for (const peak of run.peaks) {
      peakSheet.addRow({
        run: run.name,
        analyte: peak.analyteName ?? "",
        rt: peak.rt,
        mz: peak.mz ?? null,
        area: peak.area,
        height: peak.height,
        fwhm: peak.fwhm,
        sn: peak.sn,
        notes: peak.notes ?? "",
      });
      totalRows++;
    }
  }
  autoSizeColumns(peakSheet, 9, totalRows);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

/**
 * Generate an .xlsx batch summary workbook with a heatmap and per-analyte stats.
 *
 * Sheet 1 "Heatmap": analyte × run matrix with conditional formatting (color scale).
 * Sheet 2 "Summary": per-analyte stats (mean area, RSD%, found in N runs).
 */
export async function exportBatchSummaryXlsx(
  data: {
    analytes: Array<{ id: string; name: string; mz: number }>;
    runs: Array<{ id: string; name: string }>;
    matrix: (number | null)[][];
  },
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ChromaFlow";
  workbook.created = new Date();

  const { analytes, runs, matrix } = data;

  // ---- Sheet 1: Heatmap ----
  const heatmap = workbook.addWorksheet("Heatmap");

  // Header row: first cell blank, then run names
  heatmap.getCell(1, 1).value = "Analyte";
  for (let c = 0; c < runs.length; c++) {
    heatmap.getCell(1, c + 2).value = runs[c].name;
  }
  styleHeaderRow(heatmap, runs.length + 1);

  // Data rows: analyte name + values
  for (let r = 0; r < analytes.length; r++) {
    const row = heatmap.getRow(r + 2);
    row.getCell(1).value = analytes[r].name;
    for (let c = 0; c < runs.length; c++) {
      const val = matrix[r]?.[c] ?? null;
      row.getCell(c + 2).value = val;
    }
  }

  // Conditional formatting: 3-color scale across the data range
  if (analytes.length > 0 && runs.length > 0) {
    const startCol = 2;
    const endCol = runs.length + 1;
    const startRow = 2;
    const endRow = analytes.length + 1;
    const range = `${heatmap.getColumn(startCol).letter}${startRow}:${heatmap.getColumn(endCol).letter}${endRow}`;
    heatmap.addConditionalFormatting({
      ref: range,
      rules: [
        {
          type: "colorScale",
          priority: 1,
          cfvo: [
            { type: "min" },
            { type: "percentile", value: 50 },
            { type: "max" },
          ],
          color: [
            { argb: "FFF8696B" },
            { argb: "FFFFEB84" },
            { argb: "FF63BE7B" },
          ],
        },
      ],
    });
  }

  autoSizeColumns(heatmap, runs.length + 1, analytes.length + 1);

  // ---- Sheet 2: Summary ----
  const summary = workbook.addWorksheet("Summary");
  summary.columns = [
    { header: "Analyte", key: "name" },
    { header: "m/z", key: "mz" },
    { header: "Mean Area", key: "mean" },
    { header: "RSD %", key: "rsd" },
    { header: "Found in N runs", key: "found" },
    { header: "Total runs", key: "total" },
  ];
  styleHeaderRow(summary, 6);

  for (let r = 0; r < analytes.length; r++) {
    const rowVals = matrix[r] ?? [];
    const found = rowVals.filter((v) => v !== null && v !== undefined);
    const n = found.length;
    const mean = n > 0 ? found.reduce((a, b) => a + (b as number), 0) / n : 0;
    const std =
      n > 1
        ? Math.sqrt(
            found.reduce((a, b) => a + Math.pow((b as number) - mean, 2), 0) /
              (n - 1),
          )
        : 0;
    const rsd = mean !== 0 ? (std / mean) * 100 : 0;

    summary.addRow({
      name: analytes[r].name,
      mz: analytes[r].mz,
      mean: n > 0 ? mean : null,
      rsd: n > 1 ? rsd : null,
      found: n,
      total: runs.length,
    });
  }
  autoSizeColumns(summary, 6, analytes.length + 1);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}

/**
 * Generate an .xlsx quantitation results workbook with calibration curve
 * info, standards table, and quantitation results.
 */
export async function exportQuantResultsXlsx(
  data: {
    curve: {
      analyteName: string;
      modelType: string;
      slope: number;
      intercept: number;
      rSquared: number;
    };
    standards: Array<{ concentration: number; response: number; level?: number }>;
    results: Array<{
      runName: string;
      analyteName: string;
      area: number;
      concentration: number;
    }>;
  },
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ChromaFlow";
  workbook.created = new Date();

  const { curve, standards, results } = data;

  // ---- Sheet 1: Calibration Curve ----
  const curveSheet = workbook.addWorksheet("Calibration Curve");
  curveSheet.columns = [
    { header: "Parameter", key: "param" },
    { header: "Value", key: "value" },
  ];
  styleHeaderRow(curveSheet, 2);

  const curveRows: Array<{ param: string; value: number | string }> = [
    { param: "Analyte", value: curve.analyteName },
    { param: "Model Type", value: curve.modelType },
    { param: "Slope", value: curve.slope },
    { param: "Intercept", value: curve.intercept },
    { param: "R²", value: curve.rSquared },
  ];
  for (const row of curveRows) {
    curveSheet.addRow(row);
  }
  autoSizeColumns(curveSheet, 2, curveRows.length + 1);

  // ---- Sheet 2: Standards ----
  const stdSheet = workbook.addWorksheet("Standards");
  stdSheet.columns = [
    { header: "Level", key: "level" },
    { header: "Concentration", key: "concentration" },
    { header: "Response", key: "response" },
  ];
  styleHeaderRow(stdSheet, 3);

  for (const s of standards) {
    stdSheet.addRow({
      level: s.level ?? "",
      concentration: s.concentration,
      response: s.response,
    });
  }
  autoSizeColumns(stdSheet, 3, standards.length + 1);

  // ---- Sheet 3: Results ----
  const resultsSheet = workbook.addWorksheet("Results");
  resultsSheet.columns = [
    { header: "Run", key: "runName" },
    { header: "Analyte", key: "analyteName" },
    { header: "Area", key: "area" },
    { header: "Concentration", key: "concentration" },
  ];
  styleHeaderRow(resultsSheet, 4);

  for (const r of results) {
    resultsSheet.addRow({
      runName: r.runName,
      analyteName: r.analyteName,
      area: r.area,
      concentration: r.concentration,
    });
  }
  autoSizeColumns(resultsSheet, 4, results.length + 1);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: XLSX_MIME });
}
