/**
 * Canonical page-aware document model for segmentation and extraction.
 * All structure uses pageNumber + lineIndex — not blind combinedText offsets alone.
 */

import { reflowPrintedTextForHeadingDetection } from "@/lib/pdf-line-reflow";
import { sanitiseExtractedText, splitDocumentTextLayers } from "@/lib/text-layers";

export type LineSourceLayer = "printed" | "handwritten" | "ocr_noise" | "unknown";

export type LineRecord = {
  text: string;
  normalizedText: string;
  pageNumber: number;
  lineIndex: number;
  /** Primary classification for extraction (printed body vs annotation vs OCR junk). */
  sourceLayer: LineSourceLayer;
  confidence?: number;
};

export type PageRecord = {
  fileId: string;
  fileName: string;
  pageNumber: number;
  rawText: string;
  cleanedText: string;
  printedText: string;
  handwrittenText?: string;
  noiseText?: string;
  lineRecords: LineRecord[];
};

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function looksLikeNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.length <= 2 && /^[A-Za-z0-9]$/.test(t)) return true;
  if (/^[a-z]{1,3}\.{2,}/i.test(t)) return true;
  if (/\bfii+i+n\.?to\b/i.test(t)) return true;
  if (/\bDopulation\b/i.test(t)) return true;
  const alnum = (t.match(/[A-Za-z0-9]/g) ?? []).length;
  const ratio = alnum / Math.max(1, t.length);
  if (t.length < 50 && ratio < 0.35 && /[^\sA-Za-z0-9.,;=+\-()[\]{}]/.test(t)) return true;
  if (t.length < 24 && /^[A-Za-z]\s*$/.test(t)) return true;
  return false;
}

/** Only flag obvious marginalia / OCR artefacts — not normal printed prose. */
function looksHandwrittenMarginalia(line: string): boolean {
  const t = line.trim();
  if (t.length < 6 || t.length > 140) return false;
  const punctRun = /[!?.]{3,}/.test(t);
  const weirdCaps = (t.match(/[a-z][A-Z]/g) ?? []).length >= 3;
  const digitLetterChaos = (t.match(/\d/g) ?? []).length >= 4 && (t.match(/[A-Za-z]/g) ?? []).length >= 4 && /\d[A-Za-z]\d/.test(t);
  const noSpacesLongToken = /\S{36,}/.test(t);
  return weirdCaps || punctRun || (digitLetterChaos && t.length < 90) || noSpacesLongToken;
}

function normaliseLine(s: string): string {
  return s
    .replace(CTRL, "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Classify each raw line into printed / handwritten / ocr_noise for downstream extractors. */
function buildLineRecordsForPage(pageNumber: number, rawText: string): LineRecord[] {
  const lines = reflowPrintedTextForHeadingDetection(rawText).replace(/\r\n/g, "\n").split("\n");
  const out: LineRecord[] = [];
  lines.forEach((line, lineIndex) => {
    const text = line;
    let sourceLayer: LineSourceLayer = "printed";
    let confidence = 0.88;
    if (looksLikeNoiseLine(line)) {
      sourceLayer = "ocr_noise";
      confidence = 0.35;
    } else if (looksHandwrittenMarginalia(line)) {
      sourceLayer = "handwritten";
      confidence = 0.52;
    }
    out.push({
      text,
      normalizedText: normaliseLine(text),
      pageNumber,
      lineIndex,
      sourceLayer,
      confidence,
    });
  });
  return out;
}

/** Single-page document from arbitrary text (DOCX/TXT with no page breaks). */
export function singlePageRecordFromText(
  rawText: string,
  options?: { pageNumber?: number; fileId?: string; fileName?: string },
): PageRecord {
  const pageNumber = options?.pageNumber ?? 1;
  const fileId = options?.fileId ?? "local";
  const fileName = options?.fileName ?? "document";
  const raw = rawText.replace(/\r\n/g, "\n");
  const cleaned = sanitiseExtractedText(raw);
  const layers = splitDocumentTextLayers(cleaned);
  const printed =
    layers.printedText.replace(/\s+/g, " ").trim().length > 80 ? layers.printedText : cleaned;
  const lineRecords = buildLineRecordsForPage(pageNumber, printed);
  return {
    fileId,
    fileName,
    pageNumber,
    rawText: raw,
    cleanedText: cleaned,
    printedText: printed,
    handwrittenText: layers.handwrittenText || undefined,
    noiseText: layers.noiseText || undefined,
    lineRecords,
  };
}

/**
 * Build PageRecords from parsed PDF pages (or one synthetic page).
 * Uses printed layer per page for cleanedText / lineRecords; preserves raw per page.
 */
export function buildPageRecordsFromParsedPages(
  pages: Array<{ pageNumber: number; text: string }>,
  options?: { fileId?: string; fileName?: string },
): PageRecord[] {
  const fileId = options?.fileId ?? "local";
  const fileName = options?.fileName ?? "document";
  if (!pages.length) {
    return [singlePageRecordFromText("", { fileId, fileName, pageNumber: 1 })];
  }
  return pages.map((p) => {
    const raw = p.text.replace(/\r\n/g, "\n");
    const cleaned = sanitiseExtractedText(raw);
    const layers = splitDocumentTextLayers(cleaned);
    const printed =
      layers.printedText.replace(/\s+/g, " ").trim().length > 40 ? layers.printedText : cleaned;
    return {
      fileId,
      fileName,
      pageNumber: p.pageNumber,
      rawText: raw,
      cleanedText: cleaned,
      printedText: printed,
      handwrittenText: layers.handwrittenText || undefined,
      noiseText: layers.noiseText || undefined,
      lineRecords: buildLineRecordsForPage(p.pageNumber, printed),
    };
  });
}

/** Render pages to the same `[Page N]` format the rest of the pipeline expects. */
export function pageRecordsToMarkedFullText(sourceFile: string, pages: PageRecord[]): string {
  const chunks = [`[Source file: ${sourceFile}]`];
  for (const p of pages) {
    chunks.push(`[Page ${p.pageNumber}]`, p.cleanedText || p.printedText);
  }
  return chunks.join("\n\n").trim();
}

/** Collect printed text for a page range with markers (traceability). */
export function slicePageRecordsToMarkedText(
  pages: PageRecord[],
  startPage: number,
  endPage: number,
  options?: { usePrintedOnly?: boolean },
): string {
  const usePrinted = options?.usePrintedOnly !== false;
  const chunks: string[] = [];
  for (const p of pages) {
    if (p.pageNumber < startPage || p.pageNumber > endPage) continue;
    const body = usePrinted ? p.printedText : p.cleanedText;
    chunks.push(`[Page ${p.pageNumber}]`, body);
  }
  return chunks.join("\n\n").trim();
}

/** Map character offset in marked full text to page number (for legacy offsets). */
/** Renumber pages sequentially across multiple uploaded lecture files (stable chapter spans). */
export function flattenLectureFilesToFlatPages(
  files: Array<{ parsedText?: string; pages?: Array<{ pageNumber: number; text: string }> }>,
): Array<{ pageNumber: number; text: string }> {
  const out: Array<{ pageNumber: number; text: string }> = [];
  let n = 1;
  for (const f of files) {
    if (f.pages?.length) {
      for (const p of f.pages) {
        out.push({ pageNumber: n, text: p.text });
        n += 1;
      }
    } else if (f.parsedText?.trim()) {
      out.push({ pageNumber: n, text: f.parsedText });
      n += 1;
    }
  }
  return out;
}

export function pageAtOffsetInMarkedText(markedFullText: string, offset: number): number {
  let page = 1;
  for (const m of markedFullText.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((m.index ?? 0) > offset) break;
    page = Number(m[1]) || page;
  }
  return page;
}

/** Anchor for mapping a substring offset in marked full text back to page + line (for search / grounding). */
export type PageLineAnchor = {
  offset: number;
  pageNumber: number;
  lineIndex: number;
};

/**
 * Build monotonic anchors: each line start in the marked document gets pageNumber + lineIndex.
 * Use with {@link resolvePageLineAtOffset} when searching in combined `[Page N]` text.
 */
export function buildPageLineAnchorsFromMarkedText(markedFullText: string): PageLineAnchor[] {
  const anchors: PageLineAnchor[] = [];
  let pageNumber = 1;
  let lineIndex = 0;
  const lines = markedFullText.split("\n");
  let offset = 0;
  for (const line of lines) {
    const pageMark = /^\[Page\s+(\d+)\]\s*$/i.exec(line.trim());
    if (pageMark) {
      pageNumber = Number(pageMark[1]) || pageNumber;
      lineIndex = 0;
      anchors.push({ offset, pageNumber, lineIndex });
      offset += line.length + 1;
      continue;
    }
    anchors.push({ offset, pageNumber, lineIndex });
    lineIndex += 1;
    offset += line.length + 1;
  }
  return anchors;
}

/** Binary-friendly scan: last anchor with offset <= target. */
export function resolvePageLineAtOffset(anchors: PageLineAnchor[], offset: number): PageLineAnchor | null {
  if (!anchors.length) return null;
  let lo = 0;
  let hi = anchors.length - 1;
  let best = anchors[0]!;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const a = anchors[mid]!;
    if (a.offset <= offset) {
      best = a;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}
