/**
 * Page-aware academic heading candidates (document-generic).
 * All detection keys off {@link PageRecord} lineIndex + pageNumber.
 */

import type { LineRecord, PageRecord } from "@/lib/page-records";

export type HeadingKind =
  | "chapter"
  | "section"
  | "subsection"
  | "definition"
  | "lemma"
  | "proposition"
  | "theorem"
  | "corollary"
  | "proof"
  | "worked_example"
  | "example"
  | "exercise"
  | "question"
  | "solution"
  | "remark"
  | "algorithm"
  | "other";

export type HeadingCandidate = {
  text: string;
  normalizedText: string;
  pageNumber: number;
  lineIndex: number;
  headingType: HeadingKind;
  level: number;
  confidence: number;
};

const FOOTER_HEADER_HINT =
  /\b(page\s+\d+\s+of\s+\d+|^\s*\d+\s*$|copyright|©|all\s+rights\s+reserved)\b/i;

const STRONG_HEADING_FOR_NOISE =
  /^Chapter\s*\d+|^\d+\.\d+\.\d+\s+\S|^\d+\.\d+\s+\S|^Definition\s*\d*|^Lemma\s+\d+|^Theorem\s+\d+|^Proposition\s+\d+|^Corollary\s+\d+|^Proof\.?$|^Worked\s+example|^Example\s*\d*|^Exercise\s*\d*|^Question\s*\d*|^Problem\s*\d*|^Solution\s*\d*/i;

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
  return true;
}

function normaliseLineText(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function scoreHeading(kind: HeadingKind, line: string): number {
  let c = 0.72;
  if (kind === "chapter") c = 0.88;
  else if (kind === "section" || kind === "subsection") c = 0.82;
  else if (kind === "proof" || kind === "theorem" || kind === "definition") c = 0.8;
  if (line.length > 120) c -= 0.12;
  return Math.min(0.96, Math.max(0.35, c));
}

function classifyLine(trimmed: string): { kind: HeadingKind; level: number } | null {
  const t = trimmed;
  if (/^Chapter\s*\d+(?:\.\d+)?\s*$/i.test(t)) return { kind: "chapter", level: 1 };
  if (/^Chapter\s*\d+(?:\.\d+)?\s*[.:]?\s+\S/.test(t)) return { kind: "chapter", level: 1 };
  if (/^\d+\.\d+\.\d+\s+\S/.test(t)) return { kind: "subsection", level: 3 };
  if (/^\d+\.\d+\s+\S/.test(t)) return { kind: "section", level: 2 };
  /** Major numbered banner "3 Introduction" — section-level, not a PDF chapter. */
  if (/^\d{1,2}\s+[A-Za-z\u00C0-\u024F(][^\n]{3,}/.test(t) && !/^\d+\.\d/.test(t) && t.length < 130) {
    return { kind: "section", level: 2 };
  }
  if (/^Definition\s*\d*/i.test(t)) return { kind: "definition", level: 3 };
  if (/^Lemma\s+\d+/i.test(t)) return { kind: "lemma", level: 3 };
  if (/^Proposition\s+\d+/i.test(t)) return { kind: "proposition", level: 3 };
  if (/^Theorem\s+\d+/i.test(t)) return { kind: "theorem", level: 3 };
  if (/^Corollary\s+\d+/i.test(t)) return { kind: "corollary", level: 3 };
  if (/^Proof\.?$/i.test(t)) return { kind: "proof", level: 4 };
  if (/^Worked\s+example:?/i.test(t)) return { kind: "worked_example", level: 4 };
  if (/^Example\s*\d*/i.test(t)) return { kind: "example", level: 4 };
  if (/^Exercise\s*\d*/i.test(t)) return { kind: "exercise", level: 4 };
  if (/^Question\s*\d*/i.test(t)) return { kind: "question", level: 4 };
  if (/^Problem\s*\d*/i.test(t)) return { kind: "question", level: 4 };
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

/**
 * Scan pages for heading patterns. Uses printed lines; strong patterns may override a noise classification.
 */
export function detectHeadingsByPage(pages: PageRecord[]): HeadingCandidate[] {
  const flat = flattenLineRecords(pages);
  const raw: HeadingCandidate[] = [];

  for (const lr of flat) {
    const trimmed = lr.text.trim();
    if (!trimmed) continue;
    const allowNoise = lr.source === "noise" && STRONG_HEADING_FOR_NOISE.test(trimmed) && !rejectLineAsHeadingNoise(trimmed);
    if (lr.source === "noise" && !allowNoise) continue;
    if (!allowNoise && rejectLineAsHeadingNoise(trimmed)) continue;

    const cls = classifyLine(trimmed);
    if (!cls) continue;

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

    /** Legacy same-page single-line merge when next raw candidate was separate. */
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
    if (!dedup.has(k)) dedup.set(k, h);
  }
  return [...dedup.values()].sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex || a.text.localeCompare(b.text));
}
