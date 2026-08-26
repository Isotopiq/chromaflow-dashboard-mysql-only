// Parser for Thermo Chromeleon .meth instrument method files.
// These are OLE compound documents containing a UTF-16LE text section
// with a human-readable method overview (name, run time, solvents,
// column temperature, gradient timetable, etc.).
//
// The parser extracts the text section by scanning for the "Overview"
// marker in UTF-16LE encoded bytes, then regex-parses the relevant fields.

export type ParsedMethodFile = {
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
  rawText: string;
};

/**
 * Parse a Chromeleon .meth file (or any file with a similar text overview
 * section encoded in UTF-16LE) into structured method parameters.
 */
export async function parseMethodFile(file: File): Promise<ParsedMethodFile> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // The text section is UTF-16LE encoded inside the OLE container.
  // Search for the "Overview" marker as a UTF-16LE byte pattern.
  // "Overview" in UTF-16LE = 4F 00 76 00 65 00 72 00 76 00 69 00 65 00 77 00
  const overviewIdx = findUtf16LEPattern(bytes, "Overview");

  let rawText: string;
  let overviewStart: number;

  if (overviewIdx >= 0) {
    // Decode the text section starting from "Overview" (up to 30KB of UTF-16 = 60KB bytes)
    const sectionBytes = Math.min(60_000, bytes.length - overviewIdx);
    rawText = decodeUtf16LERange(bytes, overviewIdx, sectionBytes);
    overviewStart = 0;
  } else {
    // Fallback: try plain UTF-8 / ASCII "Overview"
    const utf8Bytes = new TextEncoder().encode("Overview");
    const asciiIdx = findBytePattern(bytes, utf8Bytes);
    if (asciiIdx < 0) {
      throw new Error(
        "Could not find method overview in file. This may not be a Chromeleon .meth file.",
      );
    }
    const sectionBytes = Math.min(30_000, bytes.length - asciiIdx);
    rawText = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(asciiIdx, asciiIdx + sectionBytes));
    overviewStart = 0;
  }

  return parseOverviewText(rawText);
}

/** Find a string encoded as UTF-16LE in a byte array. Returns byte offset or -1. */
function findUtf16LEPattern(bytes: Uint8Array, str: string): number {
  // Build the UTF-16LE byte pattern
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
    // Skip null chars and control chars (except tab, newline, carriage return)
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) continue;
    str += String.fromCharCode(c);
  }
  return str;
}

/** Parse the human-readable overview text into structured fields. */
function parseOverviewText(text: string): ParsedMethodFile {
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

  // Mobile phases — look for the equate values
  const mpAMatch = text.match(/%A1_Equate:\s*"([^"]+)"/);
  const mpBMatch = text.match(/%B3_Equate:\s*"([^"]+)"/);
  // Fallback: try B1 if B3 not set
  const mpB1Match = text.match(/%B1_Equate:\s*"([^"]+)"/);
  const mobilePhaseA = mpAMatch ? mpAMatch[1] : null;
  const mobilePhaseB = mpBMatch ? mpBMatch[1] : mpB1Match ? mpB1Match[1] : null;

  // Injection volume — look for InjectVolume or NeedleHeight
  const injectionVolumeUl = getNum(/InjectVolume:\s*([\d.]+)/);

  // Gradient timetable: parse lines like "1.000 [min]" followed by
  // "PumpModuleRed.RightPumpRed.Flow.Nominal: 0.180 [ml/min]" and
  // "PumpModuleRed.RightPumpRed.%B.Value: 95.0 [%]"
  const gradient = parseGradientTimetable(text);

  // Flow rate = first non-zero flow from the gradient, or the initial flow
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
    rawText: text.slice(0, 5000),
  };
}

/** Parse the gradient timetable from the "Run" section of the overview. */
function parseGradientTimetable(text: string): { time: number; pctB: number; flow: number }[] {
  // Find the "Run" stage section
  const runIdx = text.indexOf("[min] Run");
  if (runIdx < 0) return [];

  // Take the section from "Run" to "Stop Run" or end
  const stopIdx = text.indexOf("Stop Run", runIdx);
  const section = text.slice(runIdx, stopIdx > 0 ? stopIdx : undefined);

  // Split by time markers like "1.000 [min]" or "15.000 [min]"
  const timeLineRe = /(\d+\.?\d*)\s*\[min\]/g;
  const steps: { time: number; pctB: number; flow: number }[] = [];

  let lastMatch: RegExpExecArray | null = null;
  let currentText = "";

  // Collect all time markers and the text between them
  const segments: { time: number; text: string }[] = [];
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = timeLineRe.exec(section)) !== null) {
    if (lastMatch) {
      currentText = section.slice(lastMatch.index, m.index);
      segments.push({ time: parseFloat(lastMatch[1]), text: currentText });
    }
    lastMatch = m;
  }
  if (lastMatch) {
    currentText = section.slice(lastMatch.index);
    segments.push({ time: parseFloat(lastMatch[1]), text: currentText });
  }

  for (const seg of segments) {
    // Extract flow from "Flow.Nominal: X.XXX [ml/min]"
    const flowMatch = seg.text.match(/Flow\.Nominal:\s*([\d.]+)/);
    // Extract %B from "%B.Value: XX.X [%]"
    const pctBMatch = seg.text.match(/%B\.Value:\s*([\d.]+)/);

    const flow = flowMatch ? parseFloat(flowMatch[1]) : 0;
    const pctB = pctBMatch ? parseFloat(pctBMatch[1]) : 0;

    // Skip the initial 0.000 step if it has 0 flow (pump startup)
    if (seg.time === 0 && flow === 0) continue;

    steps.push({ time: seg.time, pctB, flow });
  }

  // Ensure we have a 0-min starting point
  if (steps.length > 0 && steps[0].time > 0) {
    steps.unshift({ time: 0, pctB: steps[0].pctB, flow: steps[0].flow });
  }

  return steps;
}

/** Fields that can be imported from a method file. */
export type ImportableField =
  | "name"
  | "modality"
  | "mobilePhaseA"
  | "mobilePhaseB"
  | "flowRate"
  | "columnTemp"
  | "injectionVolume"
  | "gradient"
  | "notes";

export type FieldLabel = {
  key: ImportableField;
  label: string;
  value: string;
};

/** Build a list of importable fields with display values from the parsed file. */
export function buildFieldList(parsed: ParsedMethodFile): FieldLabel[] {
  const fields: FieldLabel[] = [];

  if (parsed.name)
    fields.push({ key: "name", label: "Method name", value: parsed.name });

  if (parsed.mobilePhaseA)
    fields.push({
      key: "mobilePhaseA",
      label: "Mobile phase A",
      value: parsed.mobilePhaseA,
    });

  if (parsed.mobilePhaseB)
    fields.push({
      key: "mobilePhaseB",
      label: "Mobile phase B",
      value: parsed.mobilePhaseB,
    });

  if (parsed.flowRate != null)
    fields.push({
      key: "flowRate",
      label: "Flow rate",
      value: `${parsed.flowRate} mL/min`,
    });

  if (parsed.columnTempC != null)
    fields.push({
      key: "columnTemp",
      label: "Column temperature",
      value: `${parsed.columnTempC} °C`,
    });

  if (parsed.injectionVolumeUl != null)
    fields.push({
      key: "injectionVolume",
      label: "Injection volume",
      value: `${parsed.injectionVolumeUl} µL`,
    });

  if (parsed.gradient.length > 0)
    fields.push({
      key: "gradient",
      label: "Gradient timetable",
      value: `${parsed.gradient.length} steps (${parsed.gradient[0].pctB}%→${parsed.gradient[parsed.gradient.length - 1].pctB}% B over ${parsed.gradient[parsed.gradient.length - 1].time} min)`,
    });

  if (parsed.runTimeMin != null)
    fields.push({
      key: "notes",
      label: "Run time + instrument (in notes)",
      value: `${parsed.runTimeMin} min on ${parsed.instrument ?? "unknown instrument"}`,
    });

  return fields;
}
