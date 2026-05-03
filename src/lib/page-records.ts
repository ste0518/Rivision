/**
 * Canonical page-aware document model for segmentation and extraction.
 * All structure uses pageNumber + lineIndex — not blind combinedText offsets alone.
 */

import { sanitiseExtractedText, splitDocumentTextLayers } from "@/lib/document-profile";

export type LineSource = "printed" | "handwritten" | "noise" | "unknown";

export type LineRecord = {
  text: string;
  normalizedText: string;
  pageNumber: number;
  lineIndex: number;
  source: LineSource;
  confidence?: number;
};

export type PageRecord = {
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

function looksHandwrittenMarginalia(line: string): boolean {
  const t = line.trim();
  if (t.length < 8 || t.length > 120) return false;
  const words = t.split(/\s+/);
  if (words.length <= 4 && /^[a-z]+$/i.test(t) && t.length < 40) return true;
  const weirdCaps = (t.match(/[a-z][A-Z]/g) ?? []).length >= 2;
  const punctRun = /[!?.]{3,}/.test(t);
  return weirdCaps || punctRun;
}

function normaliseLine(s: string): string {
  return s
    .replace(CTRL, "")
    .replace(/\u00ad/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Classify each raw line into printed / handwritten / noise for downstream extractors. */
function buildLineRecordsForPage(pageNumber: number, rawText: string): LineRecord[] {
  const lines = rawText.replace(/\r\n/g, "\n").split("\n");
  const out: LineRecord[] = [];
  lines.forEach((line, lineIndex) => {
    const text = line;
    let source: LineSource = "printed";
    let confidence = 0.85;
    if (looksLikeNoiseLine(line)) {
      source = "noise";
      confidence = 0.35;
    } else if (looksHandwrittenMarginalia(line)) {
      source = "handwritten";
      confidence = 0.55;
    }
    out.push({
      text,
      normalizedText: normaliseLine(text),
      pageNumber,
      lineIndex,
      source,
      confidence,
    });
  });
  return out;
}

/** Single-page document from arbitrary text (DOCX/TXT with no page breaks). */
export function singlePageRecordFromText(rawText: string, pageNumber = 1): PageRecord {
  const raw = rawText.replace(/\r\n/g, "\n");
  const cleaned = sanitiseExtractedText(raw);
  const layers = splitDocumentTextLayers(cleaned);
  const printed =
    layers.printedText.replace(/\s+/g, " ").trim().length > 80 ? layers.printedText : cleaned;
  const lineRecords = buildLineRecordsForPage(pageNumber, printed);
  return {
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
): PageRecord[] {
  if (!pages.length) {
    return [singlePageRecordFromText("", 1)];
  }
  return pages.map((p) => {
    const raw = p.text.replace(/\r\n/g, "\n");
    const cleaned = sanitiseExtractedText(raw);
    const layers = splitDocumentTextLayers(cleaned);
    const printed =
      layers.printedText.replace(/\s+/g, " ").trim().length > 40 ? layers.printedText : cleaned;
    return {
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
