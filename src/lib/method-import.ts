// Parser for Thermo Chromeleon .meth instrument method files.
// These are OLE compound documents containing:
//   1. A UTF-16LE text section with a human-readable method overview
//      (LC parameters: name, run time, solvents, gradient timetable, etc.)
//   2. A UTF-16LE text section with an MS method summary
//      (global settings, MS1 scan, ddMS2 scan events with all parameters)
//
// The parser scans for both sections and extracts structured data.

// ---- Types ----

export type MsScan = {
  scanType: "MS1" | "ddMS2" | "tSIM" | "tMS2" | "PRM" | "AllIons";
  experimentName: string;
  startTimeMin: number | null;
  endTimeMin: number | null;
  orbitrapResolution: number | null;
  scanRangeMz: [number, number] | null;
  agcTarget: string | null;
  microscans: number | null;
  rfLensPct: number | null;
  maxInjectionTimeMode: string | null;
  maxInjectionTimeMs: number | null;
  dataType: string | null;
  polarity: string | null;
  sourceFragmentation: boolean | null;
  lockMassInjection: boolean | null;
  scanDescription: string | null;
  // ddMS2-specific
  isolationOffset: string | null;
  isolationWindow: string | null;
  isolationWindowMz: number | null;
  multiplexIonsEnabled: boolean | null;
  maxMultiplexedIons: number | null;
  reportedMass: string | null;
  turboTmt: string | null;
  scanRangeMode: string | null;
  // Filters
  intensityThreshold: number | null;
  dynamicExclusionMode: string | null;
  isotopeExclusion: string | null;
  precursorSelectionRange: [number, number] | null;
  // Raw key-value pairs not captured above
  extraParams: { key: string; value: string }[];
};

export type MsGlobalSettings = {
  useIonSourceFromTune: boolean | null;
  methodDurationMin: number | null;
  sprayVoltage: string | null;
  gasMode: string | null;
  infusionMode: string | null;
  carrierGasFlowType: string | null;
  faimsMode: string | null;
  lockMassCorrection: string | null;
  mode: string | null;
  applicationMode: string | null;
  pressureMode: string | null;
  expectedPeakWidthS: number | null;
  defaultChargeState: number | null;
  advancedPeakDetermination: boolean | null;
  mildTrapping: boolean | null;
};

export type PumpGradient = {
  pumpName: string;       // e.g. "PumpModuleRed.RightPumpRed"
  pumpLabel: string;      // e.g. "Right Pump (Red)"
  gradient: { time: number; pctB: number; flow: number }[];
};

export type ParsedMethodFile = {
  // LC parameters (from Overview section)
  name: string | null;
  instrument: string | null;
  runTimeMin: number | null;
  columnTempC: number | null;
  sampleTempC: number | null;
  mobilePhaseA: string | null;
  mobilePhaseB: string | null;
  flowRate: number | null;
  injectionVolumeUl: number | null;
  pressureLimitBar: number | null;
  gradient: { time: number; pctB: number; flow: number }[];
  // Per-pump gradients (when multiple pumps are present in the .meth file)
  pumpGradients: PumpGradient[];
  // MS parameters (from Method Summary section)
  msGlobalSettings: MsGlobalSettings | null;
  msScans: MsScan[];
  // Raw text for debugging
  rawText: string;
};

// ---- Main parser ----

/**
 * Parse a Chromeleon .meth file into structured method parameters.
 */
export async function parseMethodFile(file: File): Promise<ParsedMethodFile> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Extract the LC overview section (UTF-16LE)
  const overviewIdx = findUtf16LEPattern(bytes, "Overview");
  let lcText = "";
  if (overviewIdx >= 0) {
    const sectionBytes = Math.min(60_000, bytes.length - overviewIdx);
    lcText = decodeUtf16LERange(bytes, overviewIdx, sectionBytes);
  } else {
    // Fallback: try plain UTF-8
    const utf8Bytes = new TextEncoder().encode("Overview");
    const asciiIdx = findBytePattern(bytes, utf8Bytes);
    if (asciiIdx >= 0) {
      const sectionBytes = Math.min(30_000, bytes.length - asciiIdx);
      lcText = new TextDecoder("utf-8", { fatal: false }).decode(
        bytes.subarray(asciiIdx, asciiIdx + sectionBytes),
      );
    }
  }

  // Decode the ENTIRE file as UTF-16LE for gradient scanning.
  // Thermo .meth files are OLE compound documents — the gradient timetable
  // can be split across multiple OLE streams, so scanning just the first
  // 60KB after "Overview" misses entries that are in later streams.
  // The full decode lets us find all time markers + pump flow patterns
  // regardless of OLE stream boundaries.
  const fullText = decodeUtf16LERange(bytes, 0, bytes.length);

  // Extract the MS method summary section (UTF-16LE)
  // Look for "Method Summary" which appears in the MS method section.
  // Use the full file text for MS scan parsing, because experiments can
  // be split across multiple OLE streams (e.g. Experiment 1 in one stream
  // and Experiment 2 in another, far apart in the file).
  const msSummaryCharIdx = fullText.indexOf("Method Summary");
  let msText = "";
  if (msSummaryCharIdx >= 0) {
    msText = fullText.slice(msSummaryCharIdx);
  }

  if (!lcText && !msText) {
    throw new Error(
      "Could not find method overview or MS method summary in file. This may not be a Chromeleon .meth file.",
    );
  }

  const lc = parseOverviewText(lcText, fullText);
  const ms = parseMsMethodSummary(msText);

  // If we have per-pump gradients, pick the active pump (highest flow) as
  // the default gradient. The user can override via the import UI.
  let defaultGradient = lc.gradient;
  if (lc.pumpGradients.length > 0) {
    // Pick the pump with the highest max flow as the "active" pump
    const activePump = lc.pumpGradients.reduce((best, pg) => {
      const bestMaxFlow = Math.max(...best.gradient.map((g) => g.flow), 0);
      const pgMaxFlow = Math.max(...pg.gradient.map((g) => g.flow), 0);
      return pgMaxFlow > bestMaxFlow ? pg : best;
    });
    defaultGradient = activePump.gradient;
  }

  return {
    ...lc,
    gradient: defaultGradient,
    msGlobalSettings: ms.global,
    msScans: ms.scans,
    rawText: lcText.slice(0, 3000) + "\n---MS---\n" + msText.slice(0, 3000),
  };
}

// ---- Byte pattern helpers ----

/** Find a string encoded as UTF-16LE in a byte array. Returns byte offset or -1. */
function findUtf16LEPattern(bytes: Uint8Array, str: string): number {
  const pattern = new Uint8Array(str.length * 2);
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    pattern[i * 2] = code & 0xff;
    pattern[i * 2 + 1] = (code >> 8) & 0xff;
  }
  return findBytePattern(bytes, pattern);
}

/** Find a byte subarray pattern in a byte array. Returns byte offset or -1. */
function findBytePattern(bytes: Uint8Array, pattern: Uint8Array): number {
  outer: for (let i = 0; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) {
      if (bytes[i + j] !== pattern[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Decode a range of bytes as UTF-16LE into a string, skipping non-printable chars. */
function decodeUtf16LERange(bytes: Uint8Array, offset: number, length: number): string {
  let str = "";
  const end = Math.min(offset + length, bytes.length);
  for (let i = offset; i + 1 < end; i += 2) {
    const c = bytes[i] | (bytes[i + 1] << 8);
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) continue;
    str += String.fromCharCode(c);
  }
  return str;
}

// ---- LC Overview parser ----

/** Parse the human-readable overview text into LC fields. */
function parseOverviewText(
  text: string,
  fullText: string,
): Omit<ParsedMethodFile, "msGlobalSettings" | "msScans" | "rawText"> {
  const get = (re: RegExp): string | null => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  const getNum = (re: RegExp): number | null => {
    const s = get(re);
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };

  const name = get(/Name:\s*(.+)/);
  const instrument = get(/Instrument:\s*(.+)/);
  const runTimeMin = getNum(/Run time:\s*([\d.]+)/);
  const columnTempC = getNum(/TCC2_CC\.Temperature\.Nominal:\s*([\d.]+)/);
  const sampleTempC = getNum(/SamplerModule\.Temperature\.Nominal:\s*([\d.]+)/);
  const pressureLimitBar = getNum(/RightPumpRed\.Pressure\.UpperLimit:\s*([\d.]+)/);

  const mpAMatch = text.match(/%A1_Equate:\s*"([^"]+)"/);
  const mpBMatch = text.match(/%B3_Equate:\s*"([^"]+)"/);
  const mpB1Match = text.match(/%B1_Equate:\s*"([^"]+)"/);
  const mobilePhaseA = mpAMatch ? mpAMatch[1] : null;
  const mobilePhaseB = mpBMatch ? mpBMatch[1] : mpB1Match ? mpB1Match[1] : null;

  const injectionVolumeUl = getNum(/InjectVolume:\s*([\d.]+)/);

  // Parse per-pump gradients using the FULL file text (not just the overview
  // section) because the gradient timetable can be split across multiple OLE
  // streams in the .meth file.
  const pumpGradients = parsePumpGradients(fullText);

  // Use the legacy parser as a fallback if per-pump parsing found nothing
  let gradient: { time: number; pctB: number; flow: number }[];
  if (pumpGradients.length > 0) {
    // Pick the pump with the highest max flow as the default
    const activePump = pumpGradients.reduce((best, pg) => {
      const bestMaxFlow = Math.max(...best.gradient.map((g) => g.flow), 0);
      const pgMaxFlow = Math.max(...pg.gradient.map((g) => g.flow), 0);
      return pgMaxFlow > bestMaxFlow ? pg : best;
    });
    gradient = activePump.gradient;
  } else {
    gradient = parseGradientTimetable(fullText);
  }

  const flowRate = gradient.length > 0
    ? gradient.find((g) => g.flow > 0)?.flow ?? gradient[0].flow
    : null;

  return {
    name,
    instrument,
    runTimeMin,
    columnTempC,
    sampleTempC,
    mobilePhaseA,
    mobilePhaseB,
    flowRate,
    injectionVolumeUl,
    pressureLimitBar,
    gradient,
    pumpGradients,
  };
}

/**
 * Detect and parse per-pump gradient timetables.
 * Thermo Vanquish .meth files with dual pumps contain entries like:
 *   PumpModuleBlue.LeftPumpBlue.Flow.Nominal: 0.000 [ml/min]
 *   PumpModuleBlue.LeftPumpBlue.%B.Value: 0.0 [%]
 *   PumpModuleRed.RightPumpRed.Flow.Nominal: 0.260 [ml/min]
 *   PumpModuleRed.RightPumpRed.%B.Value: 35.0 [%]
 * This function detects all pump prefixes and returns a gradient per pump.
 *
 * IMPORTANT: The gradient timetable can be split across multiple OLE streams
 * in the .meth file. We scan the ENTIRE decoded text for time markers and
 * pump data, not just the section between "[min] Run" and "Stop Run".
 */
function parsePumpGradients(text: string): PumpGradient[] {
  // Detect all unique pump prefixes from Flow.Nominal lines across the
  // entire file (not just the "[min] Run" section).
  const pumpPrefixes = new Set<string>();
  const pumpRe = /([A-Za-z0-9_.]+)\.Flow\.Nominal:\s*[\d.]+/g;
  let m: RegExpExecArray | null;
  while ((m = pumpRe.exec(text)) !== null) {
    // Only capture prefixes that look like pump module names (contain "Pump")
    if (/Pump/i.test(m[1])) {
      pumpPrefixes.add(m[1]);
    }
  }

  if (pumpPrefixes.size === 0) return [];

  // Find all time markers in the full text: "N.NNN [min]"
  // Each time marker starts a gradient step. The pump Flow/%B values
  // appear between this time marker and the next one.
  const timeMarkerRe = /(\d+\.?\d*)\s*\[min\]/g;
  const timeMarkers: { time: number; index: number; isStopRun: boolean }[] = [];
  while ((m = timeMarkerRe.exec(text)) !== null) {
    const t = parseFloat(m[1]);
    // Only accept reasonable gradient time values (0–120 min)
    if (Number.isFinite(t) && t >= 0 && t <= 120) {
      // Check if this is a "Stop Run" marker (e.g. "33.000 [min] Stop Run")
      const afterMarker = text.slice(m.index + m[0].length, m.index + m[0].length + 20);
      const isStopRun = /Stop\s*Run/i.test(afterMarker);
      timeMarkers.push({ time: t, index: m.index, isStopRun });
    }
  }

  if (timeMarkers.length === 0) return [];

  // Find the first "Stop Run" time — this is the end of the gradient.
  // The last gradient step holds its composition until this time.
  const stopRunMarker = timeMarkers.find((tm) => tm.isStopRun);
  const stopRunTime = stopRunMarker?.time ?? null;

  // For each time marker, extract the text up to the next time marker
  // (or up to a reasonable limit) and look for pump Flow/%B values.
  const segments: { time: number; text: string }[] = [];
  for (let i = 0; i < timeMarkers.length; i++) {
    const tm = timeMarkers[i];
    const start = tm.index;
    const end = i + 1 < timeMarkers.length
      ? timeMarkers[i + 1].index
      : Math.min(start + 2000, text.length);
    const segText = text.slice(start, end);
    // Skip segments that don't contain any pump data
    // (but keep Stop Run segments — they mark the end time)
    if (!tm.isStopRun && !/Pump.*\.Flow\.Nominal:/.test(segText) && !/Pump.*\.%B\.Value:/.test(segText)) {
      continue;
    }
    segments.push({ time: tm.time, text: segText });
  }

  const results: PumpGradient[] = [];

  for (const prefix of pumpPrefixes) {
    // Build a human-readable label from the prefix
    let label = prefix;
    const colorMatch = prefix.match(/(Red|Blue|Green|Yellow)/i);
    const sideMatch = prefix.match(/(Left|Right|Rear|Front)/i);
    const parts: string[] = [];
    if (sideMatch) parts.push(sideMatch[1] + " Pump");
    else parts.push("Pump");
    if (colorMatch) parts.push(`(${colorMatch[1]})`);
    label = parts.join(" ");

    const gradient = parseGradientForPump(segments, prefix, stopRunTime);
    if (gradient.length > 0) {
      results.push({ pumpName: prefix, pumpLabel: label, gradient });
    }
  }

  return results;
}

/** Parse the gradient timetable for a specific pump prefix.
 * Accepts pre-split segments (time + text) from parsePumpGradients.
 * If stopRunTime is provided and the last gradient step is before it,
 * a final step is added at stopRunTime carrying forward the last known
 * flow and %B values (the gradient holds its final composition until
 * the run stops).
 */
function parseGradientForPump(
  segments: { time: number; text: string }[],
  prefix: string,
  stopRunTime: number | null = null,
): { time: number; pctB: number; flow: number }[] {
  const steps: { time: number; pctB: number; flow: number }[] = [];

  // Build regexes that match only this pump's Flow and %B values
  const flowRe = new RegExp(
    prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.Flow\\.Nominal:\\s*([\\d.]+)",
  );
  const pctBRe = new RegExp(
    prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.%B\\.Value:\\s*([\\d.]+)",
  );

  for (const seg of segments) {
    const flowMatch = seg.text.match(flowRe);
    const pctBMatch = seg.text.match(pctBRe);
    if (!flowMatch && !pctBMatch) continue; // No data for this pump in this segment
    const flow = flowMatch ? parseFloat(flowMatch[1]) : 0;
    const pctB = pctBMatch ? parseFloat(pctBMatch[1]) : 0;
    if (seg.time === 0 && flow === 0 && pctB === 0) {
      // Skip 0/0 entries at t=0 (idle pump placeholder)
      // Only skip if this pump has other entries with actual flow
      const hasOtherFlow = segments.some((s) => {
        if (s.time === 0) return false;
        const fm = s.text.match(flowRe);
        return fm && parseFloat(fm[1]) > 0;
      });
      if (hasOtherFlow) continue;
    }
    steps.push({ time: seg.time, pctB, flow });
  }

  // Deduplicate by time (OLE stream boundaries can cause duplicate entries)
  const seen = new Map<number, { time: number; pctB: number; flow: number }>();
  for (const s of steps) {
    if (!seen.has(s.time) || s.flow > 0) {
      seen.set(s.time, s);
    }
  }
  let deduped = Array.from(seen.values()).sort((a, b) => a.time - b.time);

  // If we know the run end time (from "Stop Run" marker) and the last
  // gradient step is before it, add a final step at the stop time
  // carrying forward the last known flow and %B. This represents the
  // hold at final composition until the run ends.
  if (stopRunTime != null && deduped.length > 0) {
    const lastStep = deduped[deduped.length - 1];
    if (lastStep.time < stopRunTime) {
      deduped.push({ time: stopRunTime, pctB: lastStep.pctB, flow: lastStep.flow });
    }
  }

  if (deduped.length > 0 && deduped[0].time > 0) {
    deduped.unshift({ time: 0, pctB: deduped[0].pctB, flow: deduped[0].flow });
  }
  return deduped;
}

/** Parse the gradient timetable from the "Run" section (legacy, single-pump).
 * Scans the full text for time markers with Flow/%B data, since the gradient
 * can be split across OLE streams.
 */
function parseGradientTimetable(text: string): { time: number; pctB: number; flow: number }[] {
  // Find all time markers in the full text, detecting "Stop Run" markers
  const timeMarkerRe = /(\d+\.?\d*)\s*\[min\]/g;
  const timeMarkers: { time: number; index: number; isStopRun: boolean }[] = [];
  let m: RegExpExecArray | null;
  while ((m = timeMarkerRe.exec(text)) !== null) {
    const t = parseFloat(m[1]);
    if (Number.isFinite(t) && t >= 0 && t <= 120) {
      const afterMarker = text.slice(m.index + m[0].length, m.index + m[0].length + 20);
      const isStopRun = /Stop\s*Run/i.test(afterMarker);
      timeMarkers.push({ time: t, index: m.index, isStopRun });
    }
  }

  if (timeMarkers.length === 0) return [];

  // Find the run end time from the first "Stop Run" marker
  const stopRunMarker = timeMarkers.find((tm) => tm.isStopRun);
  const stopRunTime = stopRunMarker?.time ?? null;

  const segments: { time: number; text: string }[] = [];
  for (let i = 0; i < timeMarkers.length; i++) {
    const tm = timeMarkers[i];
    const start = tm.index;
    const end = i + 1 < timeMarkers.length
      ? timeMarkers[i + 1].index
      : Math.min(start + 2000, text.length);
    const segText = text.slice(start, end);
    if (!tm.isStopRun && !/Flow\.Nominal:/.test(segText) && !/%B\.Value:/.test(segText)) continue;
    segments.push({ time: tm.time, text: segText });
  }

  const steps: { time: number; pctB: number; flow: number }[] = [];
  for (const seg of segments) {
    const flowMatch = seg.text.match(/Flow\.Nominal:\s*([\d.]+)/);
    const pctBMatch = seg.text.match(/%B\.Value:\s*([\d.]+)/);
    if (!flowMatch && !pctBMatch) continue;
    const flow = flowMatch ? parseFloat(flowMatch[1]) : 0;
    const pctB = pctBMatch ? parseFloat(pctBMatch[1]) : 0;
    if (seg.time === 0 && flow === 0) continue;
    steps.push({ time: seg.time, pctB, flow });
  }

  // Deduplicate by time
  const seen = new Map<number, { time: number; pctB: number; flow: number }>();
  for (const s of steps) {
    if (!seen.has(s.time) || s.flow > 0) seen.set(s.time, s);
  }
  let deduped = Array.from(seen.values()).sort((a, b) => a.time - b.time);

  // Add final step at stop-run time carrying forward last known values
  if (stopRunTime != null && deduped.length > 0) {
    const lastStep = deduped[deduped.length - 1];
    if (lastStep.time < stopRunTime) {
      deduped.push({ time: stopRunTime, pctB: lastStep.pctB, flow: lastStep.flow });
    }
  }

  if (deduped.length > 0 && deduped[0].time > 0) {
    deduped.unshift({ time: 0, pctB: deduped[0].pctB, flow: deduped[0].flow });
  }
  return deduped;
}

// ---- MS Method Summary parser ----

function parseMsMethodSummary(text: string): { global: MsGlobalSettings | null; scans: MsScan[] } {
  if (!text || text.length < 20) return { global: null, scans: [] };

  // Clean the text: remove non-printable chars that slip through
  const clean = text.replace(/[^\x20-\x7E\r\n\t]/g, "");

  const global = parseMsGlobalSettings(clean);
  const scans = parseMsScans(clean);

  return { global, scans };
}

function parseMsGlobalSettings(text: string): MsGlobalSettings | null {
  // Find "Global Settings" section
  const gsIdx = text.indexOf("Global Settings");
  if (gsIdx < 0) return null;

  // Take text from "Global Settings" to "Experiment 1" or end
  const expIdx = text.indexOf("Experiment 1", gsIdx);
  const section = text.slice(gsIdx, expIdx > 0 ? expIdx : gsIdx + 2000);

  const get = (key: string): string | null => {
    const m = section.match(new RegExp(`${key}\\s*=\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  const getNum = (key: string): number | null => {
    const s = get(key);
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  const getBool = (key: string): boolean | null => {
    const s = get(key);
    if (!s) return null;
    return /true|checked|on/i.test(s);
  };

  return {
    useIonSourceFromTune: getBool("Use Ion Source Settings from Tune"),
    methodDurationMin: getNum("Method Duration \\(min\\)"),
    sprayVoltage: get("Spray Voltage"),
    gasMode: get("Gas Mode"),
    infusionMode: get("Infusion Mode \\(LC\\)"),
    carrierGasFlowType: get("Total Carrier Gas Flow Type"),
    faimsMode: get("FAIMS Mode"),
    lockMassCorrection: get("Lock Mass Correction"),
    mode: get("Mode"),
    applicationMode: get("Application Mode"),
    pressureMode: get("Pressure Mode"),
    expectedPeakWidthS: getNum("Expected Peak Width \\(s\\)"),
    defaultChargeState: getNum("Default Charge State"),
    advancedPeakDetermination: getBool("Advanced Peak Determination"),
    mildTrapping: getBool("Mild Trapping"),
  };
}

function parseMsScans(text: string): MsScan[] {
  const scans: MsScan[] = [];

  // Split by "Experiment N" markers
  const expRe = /Experiment\s+(\d+)/g;
  const expPositions: { idx: number; num: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = expRe.exec(text)) !== null) {
    expPositions.push({ idx: m.index, num: parseInt(m[1], 10) });
  }

  for (let i = 0; i < expPositions.length; i++) {
    const start = expPositions[i].idx;
    const end = i + 1 < expPositions.length ? expPositions[i + 1].idx : text.length;
    const expSection = text.slice(start, end);

    // Within each experiment, there may be:
    //   1. A MasterScan (MS1) section
    //   2. A "Data Dependent Properties" section with "Scan Event N" entries (ddMS2)
    // Split the experiment into the MS1 part (before "Data Dependent" or "Scan Event")
    // and each "Scan Event N" section.

    // Find where the ddMS2 / data dependent section starts
    const ddIdx = expSection.indexOf("Data Dependent");
    const scanEventIdx = expSection.indexOf("Scan Event");

    // The MS1 (MasterScan) section is from the experiment start to the
    // data-dependent section (or scan events, whichever comes first)
    const ms1End = [ddIdx, scanEventIdx].filter((x) => x >= 0).sort((a, b) => a - b)[0] ?? expSection.length;
    const ms1Section = expSection.slice(0, ms1End);

    // Parse the MS1 scan if it contains "MasterScan"
    if (/MasterScan/i.test(ms1Section)) {
      const scan = parseScanSection(ms1Section);
      if (scan) scans.push(scan);
    }

    // Now parse each "Scan Event N" section within the data-dependent part
    const ddSection = expSection.slice(ms1End);
    const scanEventRe = /Scan\s+Event\s+(\d+)/g;
    const eventPositions: { idx: number; num: number }[] = [];
    while ((m = scanEventRe.exec(ddSection)) !== null) {
      eventPositions.push({ idx: m.index, num: parseInt(m[1], 10) });
    }

    for (let j = 0; j < eventPositions.length; j++) {
      const evStart = eventPositions[j].idx;
      const evEnd = j + 1 < eventPositions.length ? eventPositions[j + 1].idx : ddSection.length;
      const evSection = ddSection.slice(evStart, evEnd);
      const scan = parseScanSection(evSection);
      if (scan) scans.push(scan);
    }
  }

  return scans;
}

function parseScanSection(section: string): MsScan | null {
  // Determine scan type
  let scanType: MsScan["scanType"] = "MS1";
  if (/ddMSnScan|ddMS2/i.test(section)) scanType = "ddMS2";
  else if (/tMS2Scan|tMS2/i.test(section)) scanType = "tMS2";
  else if (/tSIMScan|tSIM/i.test(section)) scanType = "tSIM";
  else if (/PRMScan|PRM/i.test(section)) scanType = "PRM";
  else if (/AllIonsScan|AllIons/i.test(section)) scanType = "AllIons";
  else if (!/MasterScan/i.test(section)) return null; // Unknown scan type, skip

  const get = (key: string): string | null => {
    const m = section.match(new RegExp(`${key}\\s*=\\s*(.+)`));
    return m ? m[1].trim() : null;
  };
  const getNum = (key: string): number | null => {
    const s = get(key);
    if (!s) return null;
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  };
  const getBool = (key: string): boolean | null => {
    const s = get(key);
    if (!s) return null;
    return /true|on|checked/i.test(s);
  };

  const experimentName = get("Experiment Name");
  const startTimeMin = getNum("Start Time \\(min\\)");
  const endTimeMin = getNum("End Time \\(min\\)");

  // Scan range: "70-1000" or "Auto"
  const scanRangeStr = get("Scan Range \\(m/z\\)");
  let scanRangeMz: [number, number] | null = null;
  if (scanRangeStr && scanRangeStr.includes("-")) {
    const parts = scanRangeStr.split("-").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      scanRangeMz = [parts[0], parts[1]];
    }
  }

  // Precursor selection range (for ddMS2)
  const precursorRangeStr = get("Mass Range");
  let precursorSelectionRange: [number, number] | null = null;
  if (precursorRangeStr && precursorRangeStr.includes("-")) {
    const parts = precursorRangeStr.split("-").map((s) => parseFloat(s.trim()));
    if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
      precursorSelectionRange = [parts[0], parts[1]];
    }
  }

  // Isolation window
  const isolationWindowMz = getNum("Isolation Window \\(m/z\\)");

  // Max injection time: "Time (ms) = 54" for ddMS2, or "Maximum Injection Time Mode = Auto"
  const maxInjectionTimeMs = getNum("Time \\(ms\\)");

  // Collect extra params: any "Key = Value" line not captured above
  const knownKeys = new Set([
    "Experiment Name", "Start Time (min)", "End Time (min)", "IsRTNavigator",
    "Orbitrap Resolution", "Scan Range (m/z)", "AGC Target", "Microscans",
    "RF Lens(%)", "Maximum Injection Time Mode", "EASY-IC", "DataType",
    "Polarity", "Source Fragmentation", "Lock Mass Injection", "Scan Description",
    "Isolation Offset", "Multiplex Ions Enabled", "Isolation Window",
    "Isolation Window (m/z)", "Maximum number of multiplexed ions", "Reported Mass",
    "TurboTMT", "Time (ms)", "Scan Range Mode", "Intensity Filter Type",
    "Minimum Intensity", "Dynamic Exclusion Mode", "Phase: Trigger Window (%)",
    "Isotope Exclusion", "Mass Range", "Data Dependent Mode",
    "Number of Dependent Scans",
  ]);
  const extraParams: { key: string; value: string }[] = [];
  const kvRe = /([A-Za-z][A-Za-z0-9\s:%'()\-/]+?)\s*=\s*(.+)/g;
  let kvMatch: RegExpExecArray | null;
  while ((kvMatch = kvRe.exec(section)) !== null) {
    const key = kvMatch[1].trim();
    const value = kvMatch[2].trim();
    if (key.length > 0 && value.length > 0 && !knownKeys.has(key)) {
      // Avoid duplicates
      if (!extraParams.some((e) => e.key === key)) {
        extraParams.push({ key, value });
      }
    }
  }

  return {
    scanType,
    experimentName: experimentName ?? "",
    startTimeMin,
    endTimeMin,
    orbitrapResolution: getNum("Orbitrap Resolution"),
    scanRangeMz,
    agcTarget: get("AGC Target"),
    microscans: getNum("Microscans"),
    rfLensPct: getNum("RF Lens\\(%\\)"),
    maxInjectionTimeMode: get("Maximum Injection Time Mode"),
    maxInjectionTimeMs,
    dataType: get("DataType"),
    polarity: get("Polarity"),
    sourceFragmentation: getBool("Source Fragmentation"),
    lockMassInjection: getBool("Lock Mass Injection"),
    scanDescription: get("Scan Description"),
    isolationOffset: get("Isolation Offset"),
    isolationWindow: get("Isolation Window"),
    isolationWindowMz,
    multiplexIonsEnabled: getBool("Multiplex Ions Enabled"),
    maxMultiplexedIons: getNum("Maximum number of multiplexed ions"),
    reportedMass: get("Reported Mass"),
    turboTmt: get("TurboTMT"),
    scanRangeMode: get("Scan Range Mode"),
    intensityThreshold: getNum("Minimum Intensity"),
    dynamicExclusionMode: get("Dynamic Exclusion Mode"),
    isotopeExclusion: get("Isotope Exclusion"),
    precursorSelectionRange,
    extraParams,
  };
}

// ---- Import field definitions (for the selection UI) ----

export type ImportableField =
  | "name"
  | "modality"
  | "mobilePhaseA"
  | "mobilePhaseB"
  | "flowRate"
  | "columnTemp"
  | "injectionVolume"
  | "gradient"
  | "notes"
  | "msGlobalSettings"
  | "ms1Scan"
  | "ddMS2Scans"
  | "methodFile";

export type FieldLabel = {
  key: ImportableField;
  label: string;
  value: string;
};

export type FieldGroup = {
  title: string;
  fields: FieldLabel[];
};

/** Build grouped field list for the import selection UI. */
export function buildFieldGroups(parsed: ParsedMethodFile): FieldGroup[] {
  const groups: FieldGroup[] = [];

  // LC Parameters
  const lcFields: FieldLabel[] = [];
  if (parsed.name)
    lcFields.push({ key: "name", label: "Method name", value: parsed.name });
  if (parsed.mobilePhaseA)
    lcFields.push({ key: "mobilePhaseA", label: "Mobile phase A", value: parsed.mobilePhaseA });
  if (parsed.mobilePhaseB)
    lcFields.push({ key: "mobilePhaseB", label: "Mobile phase B", value: parsed.mobilePhaseB });
  if (parsed.flowRate != null)
    lcFields.push({ key: "flowRate", label: "Flow rate", value: `${parsed.flowRate} mL/min` });
  if (parsed.columnTempC != null)
    lcFields.push({ key: "columnTemp", label: "Column temperature", value: `${parsed.columnTempC} °C` });
  if (parsed.injectionVolumeUl != null)
    lcFields.push({ key: "injectionVolume", label: "Injection volume", value: `${parsed.injectionVolumeUl} µL` });
  if (parsed.gradient.length > 0) {
    const pumpInfo = parsed.pumpGradients.length > 1
      ? ` [from ${parsed.pumpGradients.find((pg) => pg.gradient === parsed.gradient)?.pumpLabel ?? "auto"}]`
      : "";
    lcFields.push({
      key: "gradient",
      label: "Gradient timetable",
      value: `${parsed.gradient.length} steps (${parsed.gradient[0].pctB}%→${parsed.gradient[parsed.gradient.length - 1].pctB}% B over ${parsed.gradient[parsed.gradient.length - 1].time} min)${pumpInfo}`,
    });
  }
  if (parsed.runTimeMin != null)
    lcFields.push({
      key: "notes",
      label: "Run time + instrument (in notes)",
      value: `${parsed.runTimeMin} min on ${parsed.instrument ?? "unknown instrument"}`,
    });
  if (lcFields.length > 0)
    groups.push({ title: "LC Parameters", fields: lcFields });

  // MS Global Settings
  if (parsed.msGlobalSettings) {
    const g = parsed.msGlobalSettings;
    const msGlobalFields: FieldLabel[] = [];
    const summary: string[] = [];
    if (g.methodDurationMin != null) summary.push(`${g.methodDurationMin} min`);
    if (g.applicationMode) summary.push(g.applicationMode);
    if (g.sprayVoltage) summary.push(`Spray: ${g.sprayVoltage}`);
    if (g.pressureMode) summary.push(g.pressureMode);
    msGlobalFields.push({
      key: "msGlobalSettings",
      label: "MS global settings",
      value: summary.join(", ") || "See details",
    });
    if (msGlobalFields.length > 0)
      groups.push({ title: "MS Global Settings", fields: msGlobalFields });
  }

  // MS1 Scans — one per experiment (e.g. positive + negative polarity)
  const ms1Scans = parsed.msScans.filter((s) => s.scanType === "MS1");
  if (ms1Scans.length > 0) {
    const fields: FieldLabel[] = ms1Scans.map((s, i) => {
      const summary: string[] = [];
      if (s.orbitrapResolution) summary.push(`R=${s.orbitrapResolution}`);
      if (s.scanRangeMz) summary.push(`${s.scanRangeMz[0]}-${s.scanRangeMz[1]} m/z`);
      if (s.polarity) summary.push(s.polarity);
      if (s.agcTarget) summary.push(`AGC=${s.agcTarget}`);
      return {
        key: "ms1Scan" as ImportableField,
        label: ms1Scans.length > 1
          ? `MS1 Scan ${i + 1}: ${s.experimentName || "Full MS Scan"}`
          : (s.experimentName || "Full MS Scan"),
        value: summary.join(", "),
      };
    });
    groups.push({ title: "MS1 Scan", fields });
  }

  // ddMS2 Scans — grouped per experiment
  const ddms2Scans = parsed.msScans.filter((s) => s.scanType === "ddMS2");
  if (ddms2Scans.length > 0) {
    // Group ddMS2 scans by experiment name (from the MS1 scan order)
    // If there are multiple experiments, show separate groups
    const expNames = ms1Scans.map((s) => s.experimentName || "");
    if (expNames.length > 1) {
      // Multiple experiments: show ddMS2 scans per experiment
      // We can't directly know which ddMS2 belongs to which experiment,
      // but they appear in order in the scans array. Split them by
      // counting — each experiment's ddMS2 scans follow its MS1 scan.
      let scanIdx = 0;
      for (let expIdx = 0; expIdx < expNames.length; expIdx++) {
        // Count ddMS2 scans until the next MS1 scan or end
        const ddScans: MsScan[] = [];
        while (scanIdx < ddms2Scans.length) {
          ddScans.push(ddms2Scans[scanIdx]);
          scanIdx++;
          // Heuristic: if there are more experiments, split evenly
          // This is a best-effort approach since the .meth format
          // doesn't explicitly tag each ddMS2 scan with its experiment
          if (expIdx < expNames.length - 1 && ddScans.length >= Math.ceil(ddms2Scans.length / expNames.length)) {
            break;
          }
        }
        if (ddScans.length === 0) continue;
        const summary = ddScans.map((s) => {
          const parts: string[] = [];
          if (s.orbitrapResolution) parts.push(`R=${s.orbitrapResolution}`);
          if (s.isolationWindowMz != null) parts.push(`ISO=${s.isolationWindowMz} m/z`);
          if (s.maxInjectionTimeMs != null) parts.push(`${s.maxInjectionTimeMs}ms`);
          if (s.maxMultiplexedIons != null) parts.push(`mux=${s.maxMultiplexedIons}`);
          return parts.join(", ");
        });
        groups.push({
          title: `ddMS2 Scans — ${expNames[expIdx]}`,
          fields: [{
            key: "ddMS2Scans",
            label: `${ddScans.length} ddMS2 scan event${ddScans.length === 1 ? "" : "s"}`,
            value: summary.join("; "),
          }],
        });
      }
    } else {
      // Single experiment: show all ddMS2 scans together
      const summary = ddms2Scans.map((s) => {
        const parts: string[] = [];
        if (s.orbitrapResolution) parts.push(`R=${s.orbitrapResolution}`);
        if (s.isolationWindowMz != null) parts.push(`ISO=${s.isolationWindowMz} m/z`);
        if (s.maxInjectionTimeMs != null) parts.push(`${s.maxInjectionTimeMs}ms`);
        if (s.maxMultiplexedIons != null) parts.push(`mux=${s.maxMultiplexedIons}`);
        return parts.join(", ");
      });
      groups.push({
        title: "ddMS2 Scans",
        fields: [{
          key: "ddMS2Scans",
          label: `${ddms2Scans.length} ddMS2 scan event${ddms2Scans.length === 1 ? "" : "s"}`,
          value: summary.join("; "),
        }],
      });
    }
  }

  // Method file attachment
  groups.push({
    title: "Method File",
    fields: [{
      key: "methodFile",
      label: "Save .meth file",
      value: "Attach the original instrument method file for download",
    }],
  });

  return groups;
}

/** Flat list of all importable fields (for backward compat). */
export function buildFieldList(parsed: ParsedMethodFile): FieldLabel[] {
  return buildFieldGroups(parsed).flatMap((g) => g.fields);
}
