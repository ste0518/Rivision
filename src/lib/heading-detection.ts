/**
 * Page-aware academic heading candidates (document-generic).
 * All detection keys off {@link PageRecord} lineIndex + pageNumber.
 */

import type { LineRecord, PageRecord } from "@/lib/page-records";

export type HeadingCandidateKind =
  | "document_title"
  | "chapter"
  | "section"
  | "subsection"
  | "subsubsection"
  | "definition"
  | "lemma"
  | "proposition"
  | "theorem"
  | "corollary"
  | "proof"
  | "remark"
  | "example"
  | "worked_example"
  | "exercise"
  | "question"
  | "solution"
  | "algorithm"
  | "figure_caption"
  | "table_caption"
  | "unknown";

export type HeadingRejectionReason =
  | "figure_axis_noise"
  | "too_many_numbers"
  | "too_many_symbols"
  | "body_sentence"
  | "footer_or_header"
  | "page_number"
  | "figure_caption_context"
  | "table_caption_context"
  | "ocr_noise"
  | "duplicate_heading";

export type HeadingCandidate = {
  text: string;
  normalizedText: string;
  pageNumber: number;
  lineIndex: number;
  headingType: HeadingCandidateKind;
  level: number;
  confidence: number;
  /** When a line was skipped as heading, short machine reason for debug. */
  rejectionReason?: HeadingRejectionReason;
};

export type RejectedHeadingCandidate = {
  text: string;
  normalizedText: string;
  pageNumber: number;
  lineIndex: number;
  rejectionReason: HeadingRejectionReason;
};

const FOOTER_HEADER_HINT =
  /\b(page\s+\d+\s+of\s+\d+|copyright|©|all\s+rights\s+reserved|lecture\s+notes\s+only)\b/i;

const PAGE_NUMBER_ONLY = /^\s*\d{1,4}\s*$/;

const AXIS_TICK_LIKE =
  /^[\d.,\s\-–—]{6,}$|^(?:0\.\d|1\.\d|-?\d+\.\d)\s+(?:0\.\d|1\.\d|-?\d+\.\d)(\s+(?:0\.\d|1\.\d|-?\d+\.\d)){2,}/;

const FIGURE_TABLE_CAPTION = /^(figure|fig\.|table)\s+\d+/i;

const STRONG_HEADING_FOR_NOISE =
  /^Chapter\s*\d+|^\d+\.\d+\.\d+\.\d+\s+\S|^\d+\.\d+\.\d+\s+\S|^\d+\.\d+\s+\S|^Definition\s*\d*|^Lemma\s+\d+|^Theorem\s+\d+|^Proposition\s+\d+|^Corollary\s+\d+|^Proof[.:]?\s*|^Worked\s+example|^Example\s*\d*|^Exercise\s*\d*|^Question\s*\d*|^Problem\s+\d+|^Solution\s*\d*|^Remark\s*\d*|^Algorithm\s*\d*/i;

/** Lines that are unlikely to be real headings (OCR noise, diagrams). */
export function rejectLineAsHeadingNoise(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 180) return true;
  const symRatio = (t.match(/[=∑∫√^_∇∂‰∞±]/g) ?? []).length / Math.max(1, t.length);
  if (symRatio > 0.22 && t.length > 80) return true;
  if (FOOTER_HEADER_HINT.test(t) && t.length < 90) return true;
  if (/^[^\w\s]{3,}$/.test(t)) return true;
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  if (t.length > 40 && letters / Math.max(1, t.length) < 0.08) return true;
  return false;
}

/** True when a line after "Chapter N" is plausibly a short chapter title, not body text. */
export function isProbableChapterSubtitleLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 3 || t.length > 100) return false;
  if (/^\d+\.\d+/.test(t)) return false;
  if (/^Chapter\s*\d+/i.test(t)) return false;
  if (/^(Theorem|Lemma|Proposition|Definition|Corollary|Figure|Table)\b/i.test(t)) return false;
  if (rejectLineAsHeadingNoise(t)) return false;
  const symRatio = (t.match(/[=∑∫√^_∇∂]/g) ?? []).length / Math.max(1, t.length);
  if (symRatio > 0.12 && t.length > 35) return false;
  if ((t.match(/\./g) ?? []).length >= 2 && t.length > 55) return false;
  if (t.split(/\s+/).length > 14) return false;
  if (/^[a-z]/.test(t) && t.length > 40) return false;
  if (/^[-*•◦]\s/.test(t)) return false;
  if (/^\d+\s*\)\s/.test(t)) return false;
  return true;
}

function normaliseLineText(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function scoreHeading(kind: HeadingCandidateKind, line: string): number {
  let c = 0.72;
  if (kind === "chapter" || kind === "document_title") c = 0.9;
  else if (kind === "section" || kind === "subsection" || kind === "subsubsection") c = 0.84;
  else if (kind === "proof" || kind === "theorem" || kind === "definition") c = 0.8;
  if (line.length > 120) c -= 0.12;
  return Math.min(0.96, Math.max(0.35, c));
}

function tooManyNumbers(t: string): boolean {
  const nums = (t.match(/\d/g) ?? []).length;
  return nums >= 14 && nums / Math.max(1, t.length) > 0.35;
}

function tooManySymbols(t: string): boolean {
  const sym = (t.match(/[^A-Za-z0-9\s.,;:()\-]/g) ?? []).length;
  return sym / Math.max(1, t.length) > 0.28 && t.split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w)).length < 4;
}

function looksLikeBodySentence(t: string): boolean {
  if (t.length < 70) return false;
  if (/^(theorem|lemma|definition|proposition|chapter)\b/i.test(t)) return false;
  const words = t.split(/\s+/).length;
  if (words > 22 && /[.;:]\s/.test(t)) return true;
  if (t.length > 110 && /^[a-z]/.test(t) && (t.match(/,\s/g) ?? []).length >= 2) return true;
  return false;
}

function rejectionForLine(trimmed: string, lr: LineRecord): HeadingRejectionReason | null {
  if (PAGE_NUMBER_ONLY.test(trimmed)) return "page_number";
  if (lr.sourceLayer === "ocr_noise" && !STRONG_HEADING_FOR_NOISE.test(trimmed)) return "ocr_noise";
  if (AXIS_TICK_LIKE.test(trimmed.trim())) return "figure_axis_noise";
  if (FIGURE_TABLE_CAPTION.test(trimmed)) {
    return /^table\b/i.test(trimmed) ? "table_caption_context" : "figure_caption_context";
  }
  if (tooManyNumbers(trimmed)) return "too_many_numbers";
  if (tooManySymbols(trimmed)) return "too_many_symbols";
  if (FOOTER_HEADER_HINT.test(trimmed) && trimmed.length < 100) return "footer_or_header";
  if (rejectLineAsHeadingNoise(trimmed)) return "figure_axis_noise";
  if (looksLikeBodySentence(trimmed)) return "body_sentence";
  return null;
}

function classifyLine(trimmed: string): { kind: HeadingCandidateKind; level: number } | null {
  const t = trimmed;
  if (/^Chapter\s*\d+(?:\.\d+)?\s*$/i.test(t)) return { kind: "chapter", level: 1 };
  if (/^Chapter\s*\d+(?:\.\d+)?\s*[.:]?\s+\S/.test(t)) return { kind: "chapter", level: 1 };
  if (/^\d+\.\d+\.\d+\.\d+\s+\S/.test(t)) return { kind: "subsubsection", level: 4 };
  if (/^\d+\.\d+\.\d+\s+\S/.test(t)) return { kind: "subsection", level: 3 };
  if (/^\d+\.\d+\s+\S/.test(t)) return { kind: "section", level: 2 };
  /** Major numbered banner "3 Introduction" — top-level chapter-like. */
  if (/^\d{1,2}\s+[A-Za-z\u00C0-\u024F(][^\n]{3,}/.test(t) && !/^\d+\.\d/.test(t) && t.length < 130) {
    return { kind: "chapter", level: 1 };
  }
  if (/^Definition\s*\d*/i.test(t)) return { kind: "definition", level: 4 };
  if (/^Lemma\s+\d+/i.test(t)) return { kind: "lemma", level: 4 };
  if (/^Proposition\s+\d+/i.test(t)) return { kind: "proposition", level: 4 };
  if (/^Theorem\s+\d+/i.test(t)) return { kind: "theorem", level: 4 };
  if (/^Corollary\s+\d+/i.test(t)) return { kind: "corollary", level: 4 };
  if (/^Proof[.:]?\s*$/i.test(t)) return { kind: "proof", level: 5 };
  if (/^Proof[.:]\s+\S/i.test(t) && t.length < 160) return { kind: "proof", level: 5 };
  if (/^Worked\s+example:?/i.test(t)) return { kind: "worked_example", level: 4 };
  if (/^Example\s*\d*/i.test(t)) return { kind: "example", level: 4 };
  if (/^Exercise\s*\d*/i.test(t)) return { kind: "exercise", level: 4 };
  if (/^Question\s*\d*/i.test(t)) return { kind: "question", level: 4 };
  if (/^Problem\s+\d+/i.test(t)) return { kind: "question", level: 4 };
  if (/^Solution\s*\d*/i.test(t)) return { kind: "solution", level: 4 };
  if (/^Algorithm\s*\d*/i.test(t)) return { kind: "algorithm", level: 4 };
  if (/^Remark\s*\d*/i.test(t)) return { kind: "remark", level: 4 };
  if (/^(Show\s+that|Derive|Check\s+that|Determine\s+whether)\b/i.test(t)) return { kind: "exercise", level: 4 };
  return null;
}

function flattenLineRecords(pages: PageRecord[]): LineRecord[] {
  const out: LineRecord[] = [];
  for (const p of pages) {
    out.push(...p.lineRecords);
  }
  return out.sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex);
}

function flatIndex(flat: LineRecord[], pageNumber: number, lineIndex: number): number {
  return flat.findIndex((r) => r.pageNumber === pageNumber && r.lineIndex === lineIndex);
}

export type HeadingDetectionResult = {
  accepted: HeadingCandidate[];
  rejected: RejectedHeadingCandidate[];
};

/**
 * Full scan with rejection audit trail for debug JSON.
 */
export function detectHeadingsByPageWithRejections(pages: PageRecord[]): HeadingDetectionResult {
  const flat = flattenLineRecords(pages);
  const raw: HeadingCandidate[] = [];
  const rejected: RejectedHeadingCandidate[] = [];

  for (const lr of flat) {
    const trimmed = lr.text.trim();
    if (!trimmed) continue;

    const cls = classifyLine(trimmed);
    const rej = rejectionForLine(trimmed, lr);

    if (cls) {
      if (rej && !(lr.sourceLayer === "ocr_noise" && STRONG_HEADING_FOR_NOISE.test(trimmed) && rej === "ocr_noise")) {
        rejected.push({
          text: trimmed.slice(0, 200),
          normalizedText: normaliseLineText(trimmed),
          pageNumber: lr.pageNumber,
          lineIndex: lr.lineIndex,
          rejectionReason: rej === "figure_axis_noise" && FIGURE_TABLE_CAPTION.test(trimmed) ?
              /^table\b/i.test(trimmed) ? "table_caption_context"
              : "figure_caption_context"
          : rej,
        });
        continue;
      }
      if (lr.sourceLayer === "ocr_noise" && !STRONG_HEADING_FOR_NOISE.test(trimmed)) {
        rejected.push({
          text: trimmed.slice(0, 200),
          normalizedText: normaliseLineText(trimmed),
          pageNumber: lr.pageNumber,
          lineIndex: lr.lineIndex,
          rejectionReason: "ocr_noise",
        });
        continue;
      }
      raw.push({
        text: trimmed,
        normalizedText: normaliseLineText(trimmed),
        pageNumber: lr.pageNumber,
        lineIndex: lr.lineIndex,
        headingType: cls.kind,
        level: cls.level,
        confidence: scoreHeading(cls.kind, trimmed),
      });
    }
  }

  /** Merge bare "Chapter k" with up to 3 following title-like lines (may span pages). */
  const merged: HeadingCandidate[] = [];
  const consumed = new Set<string>();

  for (let i = 0; i < raw.length; i += 1) {
    const cur = raw[i]!;
    const key = `${cur.pageNumber}|${cur.lineIndex}`;
    if (consumed.has(key)) continue;

    if (/^Chapter\s*\d+(?:\.\d+)?\s*$/i.test(cur.text)) {
      const idx = flatIndex(flat, cur.pageNumber, cur.lineIndex);
      if (idx >= 0) {
        const parts = [cur.text];
        let added = 0;
        for (let k = 1; k <= 3 && added < 3; k += 1) {
          const nextRec = flat[idx + k];
          if (!nextRec) break;
          const nt = nextRec.text.trim();
          if (!nt) continue;
          if (!isProbableChapterSubtitleLine(nt)) break;
          if (classifyLine(nt)) break;
          parts.push(nt);
          added += 1;
          consumed.add(`${nextRec.pageNumber}|${nextRec.lineIndex}`);
        }
        if (parts.length > 1) {
          const text = parts.join(" ").replace(/\s+/g, " ").trim();
          merged.push({
            text,
            normalizedText: normaliseLineText(text),
            pageNumber: cur.pageNumber,
            lineIndex: cur.lineIndex,
            headingType: "chapter",
            level: 1,
            confidence: 0.9,
          });
          continue;
        }
      }
    }

    const next = raw[i + 1];
    if (
      /^Chapter\s*\d+(?:\.\d+)?\s*$/i.test(cur.text) &&
      next &&
      next.pageNumber === cur.pageNumber &&
      next.lineIndex === cur.lineIndex + 1 &&
      !classifyLine(next.text) &&
      isProbableChapterSubtitleLine(next.text)
    ) {
      merged.push({
        text: `${cur.text} ${next.text}`.replace(/\s+/g, " ").trim(),
        normalizedText: `${cur.normalizedText} ${next.normalizedText}`.trim(),
        pageNumber: cur.pageNumber,
        lineIndex: cur.lineIndex,
        headingType: "chapter",
        level: 1,
        confidence: 0.9,
      });
      consumed.add(`${next.pageNumber}|${next.lineIndex}`);
      continue;
    }

    merged.push(cur);
  }

  const dedup = new Map<string, HeadingCandidate>();
  for (const h of merged) {
    const k = `${h.pageNumber}|${h.lineIndex}|${h.headingType}|${h.text.slice(0, 80)}`;
    if (dedup.has(k)) {
      rejected.push({
        text: h.text.slice(0, 200),
        normalizedText: h.normalizedText,
        pageNumber: h.pageNumber,
        lineIndex: h.lineIndex,
        rejectionReason: "duplicate_heading",
      });
      continue;
    }
    dedup.set(k, h);
  }

  const accepted = [...dedup.values()].sort(
    (a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex || a.text.localeCompare(b.text),
  );
  return { accepted, rejected };
}

/**
 * Scan pages for heading patterns. Uses printed lines; strong patterns may override a noise classification.
 */
export function detectHeadingsByPage(pages: PageRecord[]): HeadingCandidate[] {
  return detectHeadingsByPageWithRejections(pages).accepted;
}
