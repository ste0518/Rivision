/**
 * Page-aware academic heading candidates (document-generic).
 */

import type { PageRecord } from "@/lib/page-records";

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

/** Lines that are unlikely to be real headings (OCR noise, diagrams). */
export function rejectLineAsHeadingNoise(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 180) return true;
  const symRatio = (t.match(/[=∑∫√^_∇∂‰∞±]/g) ?? []).length / Math.max(1, t.length);
  if (symRatio > 0.22 && t.length > 80) return true;
  if (FOOTER_HEADER_HINT.test(t) && t.length < 90) return true;
  if (/^[^\w\s]{3,}$/.test(t)) return true;
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  if (t.length > 40 && letters / t.length < 0.08) return true;
  return false;
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
  if (/^Chapter\s+\d+/i.test(t)) return { kind: "chapter", level: 1 };
  if (/^\d+\.\d+\.\d+\s+\S/.test(t)) return { kind: "subsection", level: 3 };
  if (/^\d+\.\d+\s+\S/.test(t)) return { kind: "section", level: 2 };
  if (/^\d+\s+[A-Z][A-Za-z].{3,}/.test(t) && !/^\d+\.\d/.test(t)) return { kind: "chapter", level: 1 };
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

/**
 * If previous line is "Chapter k" and this line looks like a title, merge into one candidate (handled by pairing pass).
 */
export function detectHeadingsByPage(pages: PageRecord[]): HeadingCandidate[] {
  const raw: HeadingCandidate[] = [];

  for (const page of pages) {
    const lines = page.lineRecords;
    for (let i = 0; i < lines.length; i += 1) {
      const lr = lines[i]!;
      if (lr.source === "noise") continue;
      const trimmed = lr.text.trim();
      if (!trimmed || rejectLineAsHeadingNoise(trimmed)) continue;

      const cls = classifyLine(trimmed);
      if (!cls) continue;

      raw.push({
        text: trimmed,
        normalizedText: lr.normalizedText,
        pageNumber: lr.pageNumber,
        lineIndex: lr.lineIndex,
        headingType: cls.kind,
        level: cls.level,
        confidence: scoreHeading(cls.kind, trimmed),
      });
    }
  }

  /** Merge "Chapter 2" + next non-empty title line when title is short and not another numbered heading. */
  const merged: HeadingCandidate[] = [];
  for (let i = 0; i < raw.length; i += 1) {
    const cur = raw[i]!;
    const next = raw[i + 1];
    if (
      /^Chapter\s+\d+\s*$/i.test(cur.text) &&
      next &&
      next.pageNumber === cur.pageNumber &&
      next.lineIndex === cur.lineIndex + 1 &&
      !/^\d+\.\d/.test(next.text) &&
      next.text.length < 160 &&
      !classifyLine(next.text)
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
      i += 1;
      continue;
    }
    merged.push(cur);
  }

  return merged;
}
