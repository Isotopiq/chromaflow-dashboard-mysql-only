// Client-side PDF rendering. Uses html2canvas-pro (oklch-safe) + jsPDF.
// Renders each top-level child of the report node separately so that
// sections are never split mid-block — if a section won't fit on the
// remaining space, we leave that space blank and start it on a new page.
// Sections that are taller than a full page fall back to slicing.
import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

async function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });
}

export async function renderReportPdf(node: HTMLElement): Promise<Blob> {
  const rect = node.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) {
    throw new Error(
      "Report preview is empty — pick a method that has at least one run before generating.",
    );
  }

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  // Walk top-level blocks (header + each <section>) and lay them out one
  // by one. Any block that doesn't fit in the remaining page space gets
  // moved to a fresh page.
  const blocks = Array.from(node.children).filter(
    (c): c is HTMLElement => c instanceof HTMLElement,
  );
  if (blocks.length === 0) {
    // Fallback: capture whole node.
    blocks.push(node);
  }

  let cursorY = margin;
  let firstPage = true;

  const newPage = () => {
    if (!firstPage) pdf.addPage();
    firstPage = false;
    cursorY = margin;
  };
  newPage();

  for (const block of blocks) {
    const canvas = await captureElement(block);
    if (!canvas.width || !canvas.height) continue;

    const imgW = usableW;
    const imgH = (canvas.height * imgW) / canvas.width;

    if (imgH <= usableH) {
      // Whole block fits on a page. Start a new page if it won't fit in
      // remaining space — leave the bottom blank rather than splitting.
      if (cursorY + imgH > pageH - margin) newPage();
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      pdf.addImage(dataUrl, "JPEG", margin, cursorY, imgW, imgH);
      cursorY += imgH + 12; // small inter-block gap
    } else {
      // Block is taller than a full page — must slice this one block.
      // Start it on a fresh page for a clean break.
      if (cursorY > margin) newPage();
      const pxPerPt = canvas.width / imgW;
      const pageSlicePx = Math.floor(usableH * pxPerPt);
      let y = 0;
      let firstSlice = true;
      while (y < canvas.height) {
        const sliceH = Math.min(pageSlicePx, canvas.height - y);
        const slice = document.createElement("canvas");
        slice.width = canvas.width;
        slice.height = sliceH;
        const ctx = slice.getContext("2d")!;
        ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const dataUrl = slice.toDataURL("image/jpeg", 0.92);
        if (!firstSlice) newPage();
        pdf.addImage(dataUrl, "JPEG", margin, margin, imgW, sliceH / pxPerPt);
        y += sliceH;
        firstSlice = false;
      }
      cursorY = pageH; // force next block to a new page
    }
  }

  return pdf.output("blob");
}
