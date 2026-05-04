/**
 * Browser OCR for PDFs — full-page pass on every page (browser uploads only).
 * OCR text is primary; the PDF text layer is appended for exact glyphs / search.
 *
 * Runs only in the browser; keep tesseract as a dynamic import.
 */

import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import type { ParsedPage } from "@/lib/types";

/** Hard cap so very large lecture PDFs do not hang the tab indefinitely. */
const MAX_OCR_PAGES = 200;

export type PdfOcrAugmentResult = {
  pages: ParsedPage[];
  ocrPageCount: number;
  ocrStoppedAtPage?: number;
};

function mergePageText(vectorText: string, ocrText: string): string {
  const v = vectorText.trim();
  const o = ocrText.trim();
  if (o.length >= 28) return `${o}\n\n[PDF text layer]\n${v}`;
  if (v.length >= 1) return `${v}\n\n[OCR — low signal on this page]\n${o}`.trim();
  return o || v;
}

/**
 * Run OCR on every page (up to {@link MAX_OCR_PAGES}), merge with the vector text layer.
 */
export async function augmentPdfPagesWithBrowserOcr(
  pdf: PDFDocumentProxy,
  pages: ParsedPage[],
  warnings: string[],
): Promise<PdfOcrAugmentResult> {
  if (typeof window === "undefined" || typeof document === "undefined") return { pages, ocrPageCount: 0 };

  const total = pages.length;
  if (!total) return { pages, ocrPageCount: 0 };

  const limit = Math.min(total, MAX_OCR_PAGES);
  const ocrStoppedAtPage = total > MAX_OCR_PAGES ? MAX_OCR_PAGES : undefined;

  let ocrPageCount = 0;
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  await worker.setParameters({
    preserve_interword_spaces: "1",
  });

  try {
    const byNum = new Map(pages.map((p) => [p.pageNumber, { ...p }]));

    for (let i = 0; i < limit; i += 1) {
      const original = pages[i]!;
      const page = await pdf.getPage(original.pageNumber);
      const baseVp = page.getViewport({ scale: 1 });
      /** Higher render scale improves small-print OCR at the cost of runtime. */
      const scale = Math.min(2.35, Math.max(1.7, 1450 / baseVp.width));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const w = Math.floor(viewport.width);
      const h = Math.floor(viewport.height);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, w, h);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;

      const {
        data: { text },
      } = await worker.recognize(canvas);
      const ocrText = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

      const prev = byNum.get(original.pageNumber);
      if (!prev) continue;

      const merged = mergePageText(prev.text, ocrText);
      byNum.set(original.pageNumber, {
        ...prev,
        text: merged,
        charCount: merged.length,
        textQuality: merged.length < 80 ? "low" : merged.length < 320 ? "medium" : "high",
        warnings: [],
      });
      ocrPageCount += 1;
    }

    if (ocrPageCount > 0) {
      const tail =
        ocrStoppedAtPage !== undefined ?
          ` Processing stopped at page ${ocrStoppedAtPage} of ${total} (limit ${MAX_OCR_PAGES}) — split very long PDFs if you need the rest.`
        : "";
      warnings.push(
        `Full-document OCR ran on ${ocrPageCount} page(s), accuracy-first: OCR text is primary and the PDF text layer is appended below each page.${tail} Verify equations against the PDF — OCR often garbles math.`,
      );
    }

    const next = pages.map((p) => byNum.get(p.pageNumber) ?? p);
    return { pages: next, ocrPageCount, ocrStoppedAtPage };
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
