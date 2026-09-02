// Parser for Thermo Xcalibur .sld sequence files.
// These are OLE2 compound documents (same binary format as .meth files).
// When decoded as UTF-16LE, each injection entry follows a repeating pattern
// of non-empty lines:
//   <tray_code>         (e.g. "R:A" or "B:A" — tray:position, matches /^[A-Z]:[A-Z]/)
//   <injection_count>   (e.g. "1", a small integer)
//   <method_path>       (full Windows path to .meth file, contains backslashes)
//   <sample_name>       (e.g. "Blank2E", "EL-003E")
//   <data_output_path>  (e.g. "D:\DATA Duo-OE\...")
//   <vial_position>     (e.g. "R:A1", "B:A2" — tray:position+number)

export type SldEntry = {
  position: number;
  sampleName: string;
  sampleType: string;
  vialPosition: string;
  trayCode: string;
  methodPath: string;
  methodName: string;
  dataOutputPath: string;
  injectionVolume: number;
};

/**
 * Decode a Uint8Array as UTF-16LE, stripping non-printable characters.
 */
function decodeUtf16LE(bytes: Uint8Array): string {
  let str = "";
  const len = bytes.length;
  for (let i = 0; i + 1 < len; i += 2) {
    const c = bytes[i] | (bytes[i + 1] << 8);
    // Skip NULs and control chars except tab/newline/cr
    if (c === 0 || (c < 32 && c !== 9 && c !== 10 && c !== 13)) continue;
    str += String.fromCharCode(c);
  }
  return str;
}

/**
 * Determine the sample type from the sample name.
 *   - "blank"   if name contains "blank" (case-insensitive)
 *   - "qc"      if contains "qc"
 *   - "standard" if contains "std" or "cal"
 *   - "unknown" otherwise
 */
function classifySampleType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("blank")) return "blank";
  if (lower.includes("qc")) return "qc";
  if (lower.includes("std") || lower.includes("cal")) return "standard";
  return "unknown";
}

/**
 * Extract the method name from a Windows path by taking the last segment
 * and stripping the .meth extension (case-insensitive).
 */
function extractMethodName(methodPath: string): string {
  if (!methodPath) return "";
  // Normalize both slashes, take last segment
  const normalized = methodPath.replace(/\//g, "\\");
  const segments = normalized.split("\\").filter(Boolean);
  const last = segments.length > 0 ? segments[segments.length - 1] : methodPath;
  return last.replace(/\.meth$/i, "");
}

/**
 * Parse a decoded .sld text into a list of sequence entries by walking the
 * repeating 6-line pattern. Defensive: skips malformed/missing entries.
 */
function parseSldText(text: string): SldEntry[] {
  // Split into lines and keep only non-empty trimmed lines
  const rawLines = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      // Remove any lingering non-printable characters
      const cleaned = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "");
      if (cleaned.length > 0) lines.push(cleaned);
    }
  }

  const entries: SldEntry[] = [];
  let position = 1;
  let i = 0;

  while (i < lines.length) {
    // Find the next line that looks like a tray code (e.g. "R:A", "B:A")
    const trayCode = lines[i];
    if (!/^[A-Z]:[A-Z]/.test(trayCode)) {
      i++;
      continue;
    }

    // Need at least 6 lines from here for a full entry
    if (i + 5 >= lines.length) {
      // Not enough lines remaining; stop.
      break;
    }

    const injectionCountStr = lines[i + 1];
    const methodPath = lines[i + 2];
    const sampleName = lines[i + 3];
    const dataOutputPath = lines[i + 4];
    const vialPosition = lines[i + 5];

    // Validate the injection count is a small integer
    const injectionCount = parseInt(injectionCountStr, 10);
    if (!Number.isFinite(injectionCount) || injectionCount < 0) {
      i++;
      continue;
    }

    // Validate method path contains a backslash or .meth (defensive)
    const looksLikePath =
      methodPath.includes("\\") || /\.meth$/i.test(methodPath);
    if (!looksLikePath) {
      i++;
      continue;
    }

    // Validate sample name is non-empty
    if (!sampleName) {
      i++;
      continue;
    }

    // Validate data output path looks like a path
    if (!dataOutputPath || dataOutputPath.length === 0) {
      i++;
      continue;
    }

    // Validate vial position (tray:position+number, e.g. "R:A1")
    if (!/^[A-Z]:[A-Z]\d/.test(vialPosition)) {
      i++;
      continue;
    }

    entries.push({
      position,
      sampleName,
      sampleType: classifySampleType(sampleName),
      vialPosition,
      trayCode,
      methodPath,
      methodName: extractMethodName(methodPath),
      dataOutputPath,
      injectionVolume: injectionCount,
    });

    position++;
    i += 6;
  }

  return entries;
}

/**
 * Parse a Thermo Xcalibur .sld sequence file (as raw bytes) into structured
 * injection entries.
 */
export function parseSldFile(bytes: Uint8Array): SldEntry[] {
  const text = decodeUtf16LE(bytes);
  return parseSldText(text);
}

/**
 * Convenience wrapper that accepts an ArrayBuffer.
 */
export function parseSldFileFromArrayBuffer(buf: ArrayBuffer): SldEntry[] {
  return parseSldFile(new Uint8Array(buf));
}
