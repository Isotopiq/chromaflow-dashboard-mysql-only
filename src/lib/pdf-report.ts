// Client-side PDF rendering. Uses html2canvas-pro (oklch-safe) + jsPDF.
// Returns a Blob the caller can upload via createUploadUrl.
import jsPDF from "jspdf";
import html2canvas from "html2canvas-pro";

export async function renderReportPdf(node: HTMLElement): Promise<Blob> {
  const rect = node.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) {
    throw new Error(
      "Report preview is empty — pick a method that has at least one run before generating.",
    );
  }
  // Capture at 2x for crisp text.
  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
    logging: false,
  });
  if (!canvas.width || !canvas.height) {
    throw new Error("Failed to render report preview to canvas.");
  }

  const pdf = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 24;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;

  const imgW = usableW;
  const imgH = (canvas.height * imgW) / canvas.width;

  if (imgH <= usableH) {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    pdf.addImage(dataUrl, "JPEG", margin, margin, imgW, imgH);
  } else {
    // Slice the tall canvas into page-sized chunks.
    const pxPerPt = canvas.width / imgW;
    const pageSlicePx = Math.floor(usableH * pxPerPt);
    let y = 0;
    let first = true;
    while (y < canvas.height) {
      const sliceH = Math.min(pageSlicePx, canvas.height - y);
      const slice = document.createElement("canvas");
      slice.width = canvas.width;
      slice.height = sliceH;
      const ctx = slice.getContext("2d")!;
      ctx.drawImage(canvas, 0, y, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
      const dataUrl = slice.toDataURL("image/jpeg", 0.92);
      if (!first) pdf.addPage();
      pdf.addImage(dataUrl, "JPEG", margin, margin, imgW, sliceH / pxPerPt);
      y += sliceH;
      first = false;
    }
  }

  return pdf.output("blob");
}
