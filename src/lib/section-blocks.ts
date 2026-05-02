/**
 * Structural segmentation of lecture notes by headings (document-generic).
 */

import { sanitiseExtractedText } from "@/lib/document-profile";

export type SectionBlock = {
  sectionId: string;
  heading: string;
  startPage: number;
  endPage: number;
  text: string;
  formulas: string[];
  workedExamples: string[];
  proofs: string[];
  exercises: string[];
};

const CHAPTER_RE = /^(?:Chapter|CHAPTER)\s+(\d+(?:\.\d+)*)\s*[.:]?\s*(.+)$/i;
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*)\s+(.+)$/;
const DEFINITION_RE = /^Definition\s+(\d+(?:\.\d+)*)\b/i;
const WORKED_EXAMPLE_RE = /^Worked\s+example\s*[:.-]?\s*(.*)$/i;
const EXAMPLE_RE = /^Example\s*[:.-]?\s*(.*)$/i;
const EXERCISE_RE = /^(?:Exercise|Problem|Question)\s+(\d+(?:\.\d+)*)\b/i;
const PROOF_RE = /^Proof\s*[.:]?\s*/i;
const ALGORITHM_RE = /^Algorithm\s+(\d+(?:\.\d+)*)/i;

function pageAt(fullText: string, offset: number): number {
  let page = 1;
  for (const m of fullText.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((m.index ?? 0) > offset) break;
    page = Number(m[1]) || page;
  }
  return page;
}

function classifyLine(line: string): "chapter" | "numbered" | "definition" | "worked" | "example" | "exercise" | "proof" | "algorithm" | "other" {
  const t = line.trim();
  if (CHAPTER_RE.test(t)) return "chapter";
  if (DEFINITION_RE.test(t)) return "definition";
  if (WORKED_EXAMPLE_RE.test(t)) return "worked";
  if (EXAMPLE_RE.test(t) && !/^examples?\s+$/i.test(t)) return "example";
  if (EXERCISE_RE.test(t)) return "exercise";
  if (PROOF_RE.test(t)) return "proof";
  if (ALGORITHM_RE.test(t)) return "algorithm";
  if (NUMBERED_HEADING_RE.test(t)) {
    const m = t.match(NUMBERED_HEADING_RE);
    const rest = m?.[2]?.trim() ?? "";
    if (rest.length >= 4 && /^[A-Za-z]/.test(rest)) return "numbered";
  }
  return "other";
}

function headingKey(line: string): string {
  const t = line.trim();
  const ch = t.match(CHAPTER_RE);
  if (ch) return `chapter:${ch[1]}`;
  const d = t.match(DEFINITION_RE);
  if (d) return `def:${d[1]}`;
  const ex = t.match(EXERCISE_RE);
  if (ex) return `exe:${ex[1]}`;
  const num = t.match(NUMBERED_HEADING_RE);
  if (num) return `num:${num[1]}`;
  if (WORKED_EXAMPLE_RE.test(t)) return `worked:${t.slice(0, 80)}`;
  if (EXAMPLE_RE.test(t)) return `ex:${t.slice(0, 80)}`;
  if (PROOF_RE.test(t)) return `proof:${t.slice(0, 40)}`;
  if (ALGORITHM_RE.test(t)) return `alg:${t.slice(0, 60)}`;
  return `other:${t.slice(0, 60)}`;
}

/** Approximate heading level: smaller number / fewer dots => higher level. */
function headingLevel(line: string): number {
  const t = line.trim();
  const ch = t.match(CHAPTER_RE);
  if (ch) return 1;
  const num = t.match(/^(\d+(?:\.\d+)*)/);
  if (num) return num[1]!.split(".").length;
  if (DEFINITION_RE.test(t) || EXERCISE_RE.test(t) || WORKED_EXAMPLE_RE.test(t) || EXAMPLE_RE.test(t) || PROOF_RE.test(t) || ALGORITHM_RE.test(t))
    return 4;
  return 9;
}

export function buildSectionBlocks(fullText: string, primarySourceLabel = "notes"): SectionBlock[] {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  const lines = text.split("\n");
  const headings: Array<{ offset: number; line: string; kind: ReturnType<typeof classifyLine>; level: number }> = [];

  let offset = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length >= 6) {
      const kind = classifyLine(trimmed);
      if (kind !== "other") {
        headings.push({ offset, line: trimmed, kind, level: headingLevel(trimmed) });
      }
    }
    offset += line.length + 1;
  }

  if (!headings.length) {
    return [
      {
        sectionId: `${primarySourceLabel}-whole`,
        heading: "Document",
        startPage: pageAt(text, 0),
        endPage: pageAt(text, text.length - 1),
        text: text.slice(0, 120_000),
        formulas: [],
        workedExamples: [],
        proofs: [],
        exercises: [],
      },
    ];
  }

  const blocks: SectionBlock[] = [];
  for (let i = 0; i < headings.length; i += 1) {
    const h = headings[i]!;
    const start = h.offset;
    const curLevel = h.level;
    let end = text.length;
    for (let j = i + 1; j < headings.length; j += 1) {
      if (headings[j]!.level <= curLevel) {
        end = headings[j]!.offset;
        break;
      }
    }

    const body = text.slice(start, end).trim();
    if (body.length < 8) continue;

    const formulas: string[] = [];
    for (const ln of body.split("\n")) {
      const tr = ln.trim();
      if (/[=∑∫∝]/.test(tr) && tr.length < 500 && tr.length > 6) formulas.push(tr.slice(0, 400));
    }

    const workedExamples: string[] = [];
    const proofs: string[] = [];
    const exercises: string[] = [];

    if (h.kind === "worked" || (h.kind === "example" && /worked/i.test(h.line))) {
      workedExamples.push(body.slice(0, 8000));
    } else if (h.kind === "proof") {
      proofs.push(body.slice(0, 8000));
    } else if (h.kind === "exercise") {
      exercises.push(body.slice(0, 8000));
    }

    blocks.push({
      sectionId: `${primarySourceLabel}-${headingKey(h.line)}-${i}`,
      heading: h.line.slice(0, 200),
      startPage: pageAt(text, start),
      endPage: pageAt(text, Math.max(start, end - 1)),
      text: body.slice(0, 50_000),
      formulas: formulas.slice(0, 40),
      workedExamples,
      proofs,
      exercises,
    });
  }

  return dedupeBlocks(blocks);
}

function dedupeBlocks(blocks: SectionBlock[]): SectionBlock[] {
  const seen = new Set<string>();
  const out: SectionBlock[] = [];
  for (const b of blocks) {
    const k = `${b.heading}|${b.startPage}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out.slice(0, 400);
}
