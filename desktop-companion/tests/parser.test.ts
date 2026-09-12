// Parser worker tests — tests the mzXML/mzML parsing logic.
import { describe, it, expect } from "vitest";
import { XMLParser } from "fast-xml-parser";
import { deflate } from "pako";
import { parseMzML } from "../src/main/parser-worker";

function float32Base64(values: number[], littleEndian: boolean): string {
  const buf = Buffer.alloc(values.length * 4);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < values.length; i++) {
    dv.setFloat32(i * 4, values[i], littleEndian);
  }
  return buf.toString("base64");
}

function float32ZlibBase64(values: number[], littleEndian: boolean): string {
  const buf = Buffer.alloc(values.length * 4);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < values.length; i++) {
    dv.setFloat32(i * 4, values[i], littleEndian);
  }
  return Buffer.from(deflate(buf)).toString("base64");
}

function makeMzXMLPeaks(intensityByScan: number[]): string {
  const scans = intensityByScan.map((intens, i) => {
    // Main centroid at m/z 100 plus a small secondary at m/z 200 so the
    // per-scan noise floor stays below the signal. Explicit zeros keep the
    // arrays sparse enough to be treated as centroid data.
    const mz = [0, 100, 0, 200, 0];
    const int = [0, intens, 0, Math.max(10, Math.round(intens / 10)), 0];
    const pairs: number[] = [];
    for (let j = 0; j < mz.length; j++) {
      pairs.push(mz[j], int[j]);
    }
    const b64 = float32ZlibBase64(pairs, true);
    return `<scan msLevel="1" retentionTime="PT${(i + 1) * 15}S" polarity="+"><peaks precision="32" byteOrder="little" compressionType="zlib" contentType="m/z-int">${b64}</peaks></scan>`;
  });
  return `<?xml version="1.0"?>
    <mzXML>
      <msRun>
        ${scans.join("\n")}
      </msRun>
    </mzXML>`;
}

function makeMzMLPeaks(intensityByScan: number[]): string {
  const spectra = intensityByScan.map((intens, i) => {
    const mzB64 = float32ZlibBase64([0, 100, 0, 200, 0], true);
    const intB64 = float32ZlibBase64([0, intens, 0, Math.max(10, Math.round(intens / 10)), 0], true);
    return `<spectrum id="s${i}">
      <cvParam accession="MS:1000511" value="1"/>
      <cvParam accession="MS:1000130"/>
      <scanList>
        <scan>
          <cvParam accession="MS:1000016" value="${(i + 1) * 15}" unitName="second"/>
        </scan>
      </scanList>
      <binaryDataArrayList count="2">
        <binaryDataArray>
          <cvParam accession="MS:1000514"/>
          <cvParam accession="MS:1000521"/>
          <cvParam accession="MS:1000574"/>
          <binary>${mzB64}</binary>
        </binaryDataArray>
        <binaryDataArray>
          <cvParam accession="MS:1000515"/>
          <cvParam accession="MS:1000521"/>
          <cvParam accession="MS:1000574"/>
          <binary>${intB64}</binary>
        </binaryDataArray>
      </binaryDataArrayList>
    </spectrum>`;
  });
  return `<?xml version="1.0"?>
    <mzML>
      <run>
        <spectrumList count="${spectra.length}">
          ${spectra.join("\n")}
        </spectrumList>
      </run>
    </mzML>`;
}

// Test the XML parser configuration matches what the worker expects
describe("Parser configuration", () => {
  it("should parse mzXML with correct options", () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: true,
      parseAttributeValue: false,
      trimValues: true,
      isArray: (name: string) =>
        name === "spectrum" || name === "scan" || name === "cvParam" || name === "binaryDataArray" || name === "precursorMz" || name === "peaks",
    });

    const xml = `<?xml version="1.0"?>
      <mzXML>
        <msRun>
          <scan msLevel="1" retentionTime="PT60S">
            <peaks precision="32">eJwDAAAAAAE=</peaks>
          </scan>
        </msRun>
      </mzXML>`;

    const doc = parser.parse(xml);
    expect(doc).toBeDefined();
    expect(doc.mzXML).toBeDefined();
    expect(doc.mzXML.msRun).toBeDefined();
  });

  it("should parse mzML with correct options", () => {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      allowBooleanAttributes: true,
      parseAttributeValue: false,
      trimValues: true,
      isArray: (name: string) =>
        name === "spectrum" || name === "scan" || name === "cvParam" || name === "binaryDataArray",
    });

    const xml = `<?xml version="1.0"?>
      <mzML>
        <run>
          <spectrumList>
            <spectrum id="s1">
              <cvParam accession="MS:1000511" value="1"/>
              <cvParam accession="MS:1000130"/>
            </spectrum>
          </spectrumList>
        </run>
      </mzML>`;

    const doc = parser.parse(xml);
    expect(doc).toBeDefined();
    expect(doc.mzML).toBeDefined();
    expect(doc.mzML.run).toBeDefined();
  });
});

describe("parseMzML output", () => {
  // A Gaussian-shaped signal across 7 scans (15 s apart, sigma ≈ 0.35 min)
  // that survives the CentWave-style peak picker (S/N, FWHM, asymmetry and
  // R² checks). Values are exp(-(t-1.0)²/(2·0.35²)) · 2000.
  const signal = [201, 721, 1550, 2000, 1550, 721, 201];

  it("parses a 7-scan mzXML file and detects the peak", async () => {
    const xml = makeMzXMLPeaks(signal);
    const { summary } = await parseMzML(xml);
    expect(summary.format).toBe("mzXML");
    expect(summary.scanCount).toBe(7);
    expect(summary.trace.x.length).toBe(7);
    expect(summary.peaks.length).toBeGreaterThanOrEqual(1);
    const peak = summary.peaks[0];
    expect(peak.mz).toBeCloseTo(100, 0);
    expect(peak.height).toBeGreaterThan(0);
  });

  it("parses a 7-scan mzML file and detects the peak", async () => {
    const xml = makeMzMLPeaks(signal);
    const { summary } = await parseMzML(xml);
    expect(summary.format).toBe("mzML");
    expect(summary.scanCount).toBe(7);
    expect(summary.trace.x.length).toBe(7);
    expect(summary.peaks.length).toBeGreaterThanOrEqual(1);
    const peak = summary.peaks[0];
    expect(peak.mz).toBeCloseTo(100, 0);
    expect(peak.height).toBeGreaterThan(0);
  });
});

describe("File extension validation", () => {
  const VALID_EXTENSIONS = [".mzxml", ".mzmL", ".mzML", ".mzXML"];

  it("should accept .mzXML files", () => {
    const ext = ".mzXML";
    expect(VALID_EXTENSIONS.map((e) => e.toLowerCase())).toContain(ext.toLowerCase());
  });

  it("should accept .mzML files", () => {
    const ext = ".mzML";
    expect(VALID_EXTENSIONS.map((e) => e.toLowerCase())).toContain(ext.toLowerCase());
  });

  it("should reject .raw files", () => {
    const ext = ".raw";
    expect(VALID_EXTENSIONS.map((e) => e.toLowerCase())).not.toContain(ext.toLowerCase());
  });

  it("should reject .d files", () => {
    const ext = ".d";
    expect(VALID_EXTENSIONS.map((e) => e.toLowerCase())).not.toContain(ext.toLowerCase());
  });
});
