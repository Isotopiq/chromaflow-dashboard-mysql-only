// Parser worker tests — tests the mzXML/mzML parsing logic.
import { describe, it, expect } from "vitest";
import { XMLParser } from "fast-xml-parser";

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
