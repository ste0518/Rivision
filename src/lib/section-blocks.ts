/**
 * Structural segmentation of lecture notes by chapter & numbered headings (document-generic).
 */

import { sanitiseExtractedText } from "@/lib/document-profile";
import {
  chapterContextAt,
  collectStructuralHeadings,
  pageAtOffset,
  type StructuralHeading,
} from "@/lib/lecture-segmentation";

export type SectionBlock = {
  sectionId: string;
  chapterLabel: string;
  chapterTitle: string;
  heading: string;
  level: number;
  startPage: number;
  endPage: number;
  text: string;
  formulas: string[];
  definitions: string[];
  workedExamples: string[];
  proofsAndDerivations: string[];
  /** @deprecated Prefer proofsAndDerivations */
  proofs?: string[];
  exercises?: string[];
};

const MAX_SECTION_PAGES = 12;

function extractInlineArrays(body: string): {
  formulas: string[];
  definitions: string[];
  workedExamples: string[];
  proofsAndDerivations: string[];
} {
  const formulas: string[] = [];
  const definitions: string[] = [];
  const workedExamples: string[] = [];
  const proofsAndDerivations: string[] = [];

  for (const ln of body.split("\n")) {
    const tr = ln.trim();
    if (!tr) continue;
    if (/^Worked\s+example\s*:/i.test(tr)) workedExamples.push(tr.slice(0, 600));
    else if (/^(Proof|Show\s+that)\b/i.test(tr)) proofsAndDerivations.push(tr.slice(0, 600));
    else if (/\bdefined\s+as\b|^Definition\b/i.test(tr) && tr.length < 800) definitions.push(tr.slice(0, 500));
    else if (/[=∑∫]|\\sum|\\int|\bcov\s*\(|\\bVar\b|\\mathbb\{E\}|ρ_|φ_|\\Phi\(B\)|MA\(|AR\(|ARMA|ARCH|ARIMA/i.test(tr) && tr.length > 6 && tr.length < 500) {
      formulas.push(tr.slice(0, 400));
    }
  }

  return {
    formulas: dedupeStr(formulas, 40),
    definitions: dedupeStr(definitions, 20),
    workedExamples: dedupeStr(workedExamples, 15),
    proofsAndDerivations: dedupeStr(proofsAndDerivations, 20),
  };
}

function dedupeStr(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of items) {
    const k = x.replace(/\s+/g, " ").slice(0, 120).toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

/** Split oversized spans using `[Page N]` boundaries so each piece spans ≤ maxPages. */
function splitByPageBudget(fullText: string, body: string, maxPages: number): Array<{ slice: string; startPage: number; endPage: number }> {
  const anchorStart = Math.max(0, fullText.indexOf(body));
  const startPage = pageAtOffset(fullText, anchorStart);
  const endPage = pageAtOffset(fullText, anchorStart + Math.max(0, body.length - 1));
  if (endPage - startPage < maxPages) {
    return [{ slice: body, startPage, endPage }];
  }

  const chunks = body.split(/(?=\n\[Page\s+\d+\])/);
  const segments: Array<{ page: number; text: string }> = [];
  let carryPage = startPage;
  for (const chunk of chunks) {
    const pm = chunk.match(/\[Page\s+(\d+)\]/i);
    const pg = pm ? Number(pm[1]) || carryPage : carryPage;
    carryPage = pg;
    segments.push({ page: pg, text: chunk });
  }
  if (segments.length <= 1) {
    return [{ slice: body.slice(0, 50_000), startPage, endPage }];
  }

  const runs: Array<{ slice: string; startPage: number; endPage: number }> = [];
  let buf = "";
  let rs = segments[0]!.page;
  let re = segments[0]!.page;

  const flush = () => {
    const t = buf.trim();
    if (t.length > 8) runs.push({ slice: t.slice(0, 50_000), startPage: rs, endPage: re });
    buf = "";
  };

  for (const seg of segments) {
    if (!buf) {
      rs = seg.page;
      re = seg.page;
      buf = seg.text;
      continue;
    }
    if (seg.page - rs >= maxPages) {
      flush();
      buf = seg.text;
      rs = seg.page;
      re = seg.page;
    } else {
      buf += seg.text;
      re = seg.page;
    }
  }
  flush();
  return runs.length ? runs : [{ slice: body.slice(0, 50_000), startPage, endPage }];
}

function headingKey(h: StructuralHeading, idx: number): string {
  return `${h.kind}:${h.label}:${idx}`;
}

export function buildSectionBlocks(fullText: string, primarySourceLabel = "notes"): SectionBlock[] {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  const structural = collectStructuralHeadings(text);

  if (structural.length === 0) {
    return [
      {
        sectionId: `${primarySourceLabel}-whole`,
        chapterLabel: "",
        chapterTitle: "",
        heading: "Document",
        level: 9,
        startPage: pageAtOffset(text, 0),
        endPage: pageAtOffset(text, Math.max(0, text.length - 1)),
        text: text.slice(0, 120_000),
        formulas: [],
        definitions: [],
        workedExamples: [],
        proofsAndDerivations: [],
        proofs: [],
        exercises: [],
      },
    ];
  }

  const blocks: SectionBlock[] = [];

  for (let i = 0; i < structural.length; i += 1) {
    const h = structural[i]!;
    const curLevel = h.level;
    let end = text.length;
    for (let j = i + 1; j < structural.length; j += 1) {
      const hj = structural[j]!;
      if (hj.level <= curLevel) {
        end = hj.startOffset;
        break;
      }
    }

    const body = text.slice(h.startOffset, end).trim();
    if (body.length < 12) continue;

    const ctx = chapterContextAt(structural, h.startOffset);
    const chapterLabel = ctx.chapterLabel || (h.kind === "chapter" ? h.label : "");
    const chapterTitle = ctx.chapterTitle || (h.kind === "chapter" ? h.title : "");

    const headingTitle = h.kind === "chapter" ? `${h.label}: ${h.title}` : `${h.label} ${h.title}`;
    const inline = extractInlineArrays(body);

    const spans = splitByPageBudget(text, body, MAX_SECTION_PAGES);
    let part = 0;
    for (const span of spans) {
      part += 1;
      const secInline = extractInlineArrays(span.slice);
      const sectionId =
        spans.length > 1 ?
          `${primarySourceLabel}-${headingKey(h, i)}-p${part}`
        : `${primarySourceLabel}-${headingKey(h, i)}`;

      blocks.push({
        sectionId,
        chapterLabel,
        chapterTitle,
        heading: headingTitle.slice(0, 220),
        level: h.level,
        startPage: span.startPage,
        endPage: span.endPage,
        text: span.slice,
        formulas: secInline.formulas,
        definitions: secInline.definitions,
        workedExamples: secInline.workedExamples,
        proofsAndDerivations: secInline.proofsAndDerivations,
        proofs: secInline.proofsAndDerivations.filter((p) => /^Proof\b/i.test(p)),
        exercises: [],
      });
    }
  }

  return dedupeBlocks(blocks);
}

function dedupeBlocks(blocks: SectionBlock[]): SectionBlock[] {
  const seen = new Set<string>();
  const out: SectionBlock[] = [];
  for (const b of blocks) {
    const k = `${b.heading}|${b.startPage}|${b.endPage}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(b);
  }
  return out.slice(0, 500);
}
