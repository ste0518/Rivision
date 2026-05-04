/**
 * Structural segmentation of lecture notes by chapter & numbered headings (document-generic).
 */

import type { HeadingCandidate } from "@/lib/heading-detection";
import type { PageRecord } from "@/lib/page-records";
import { slicePageRecordsToMarkedText } from "@/lib/page-records";
import { sanitiseExtractedText, type ChapterMapEntry } from "@/lib/document-profile";
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
  /** From page-aware heading detection when available. */
  headingType?: string;
  level: number;
  /** Nearest enclosing structural heading text (section / subsection / chapter). */
  parentSection?: string;
  /** Immediate nested heading lines until the next boundary (diagnostic). */
  childHeadings?: string[];
  /** Counts from {@link extractInlineArrays} for QA. */
  candidateCounts?: Record<string, number>;
  startPage: number;
  endPage: number;
  /** Inclusive line index on startPage when derived from PageRecord lines (optional). */
  startLineIndex?: number;
  /** Exclusive line index on endPage when derived from PageRecord lines (optional). */
  endLineIndex?: number;
  text: string;
  formulas: string[];
  definitions: string[];
  workedExamples: string[];
  proofsAndDerivations: string[];
  /** @deprecated Prefer proofsAndDerivations */
  proofs?: string[];
  exercises?: string[];
  formulaCandidates?: string[];
  definitionCandidates?: string[];
  theoremCandidates?: string[];
  proofCandidates?: string[];
  exampleCandidates?: string[];
  exerciseCandidates?: string[];
};

const MAX_SECTION_PAGES = 12;

export function extractInlineArrays(body: string): {
  formulas: string[];
  definitions: string[];
  workedExamples: string[];
  proofsAndDerivations: string[];
  theoremCandidates: string[];
  proofCandidates: string[];
  exampleCandidates: string[];
  exerciseCandidates: string[];
} {
  const formulas: string[] = [];
  const definitions: string[] = [];
  const workedExamples: string[] = [];
  const proofsAndDerivations: string[] = [];
  const theoremCandidates: string[] = [];
  const proofCandidates: string[] = [];
  const exampleCandidates: string[] = [];
  const exerciseCandidates: string[] = [];

  for (const ln of body.split("\n")) {
    const tr = ln.trim();
    if (!tr) continue;
    if (/^Worked\s+example\s*:/i.test(tr)) workedExamples.push(tr.slice(0, 600));
    else if (/^(Proof|Show\s+that|Derive)\b/i.test(tr)) {
      proofsAndDerivations.push(tr.slice(0, 600));
      proofCandidates.push(tr.slice(0, 600));
    } else if (/^(Hence|Therefore|Thus),?\b/i.test(tr) && /[=∑∫∂]/.test(tr)) {
      proofsAndDerivations.push(tr.slice(0, 600));
      proofCandidates.push(tr.slice(0, 600));
    } else if (/^(Theorem|Lemma|Proposition|Corollary)\s+\d/i.test(tr)) theoremCandidates.push(tr.slice(0, 600));
    else if (/^Proof\b/i.test(tr)) proofCandidates.push(tr.slice(0, 600));
    else if (/^(Example|Exercise)\s+\d/i.test(tr)) {
      exampleCandidates.push(tr.slice(0, 600));
      if (/^Exercise\b/i.test(tr)) exerciseCandidates.push(tr.slice(0, 600));
    } else if (/^(Check\s+that|For\s+instance|Let\s+us\s+calculate)/i.test(tr)) exampleCandidates.push(tr.slice(0, 600));
    else if (/\bdefined\s+as\b|^Definition\b/i.test(tr) && tr.length < 800) definitions.push(tr.slice(0, 500));
    else if (
      /[=∑∫∇∂×]|\\sum|\\int|\\partial|\\nabla|\bcov\s*\(|\\bVar\b|\\mathbb\{E\}|ρ_|φ_|κ|τ|Gaussian|det\s*\(|tr\s*\(/i.test(tr) &&
      tr.length > 6 &&
      tr.length < 500
    ) {
      formulas.push(tr.slice(0, 400));
    }
  }

  return {
    formulas: dedupeStr(formulas, 80),
    definitions: dedupeStr(definitions, 40),
    workedExamples: dedupeStr(workedExamples, 25),
    proofsAndDerivations: dedupeStr(proofsAndDerivations, 40),
    theoremCandidates: dedupeStr(theoremCandidates, 40),
    proofCandidates: dedupeStr(proofCandidates, 40),
    exampleCandidates: dedupeStr(exampleCandidates, 40),
    exerciseCandidates: dedupeStr(exerciseCandidates, 25),
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

/** When headings are missing, split on `[Page N]` every maxPages so extraction never sees one 90-page slab. */
export function buildSectionBlocksByPageWindows(fullText: string, primarySourceLabel: string, maxPages: number): SectionBlock[] {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  const startPg = pageAtOffset(text, 0);
  const endPg = pageAtOffset(text, Math.max(0, text.length - 1));
  if (endPg - startPg < maxPages) {
    return [
      {
        sectionId: `${primarySourceLabel}-whole`,
        chapterLabel: "",
        chapterTitle: "",
        heading: "Document",
        level: 9,
        startPage: startPg,
        endPage: endPg,
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

  const chunks = text.split(/(?=\n\[Page\s+\d+\])/);
  const segments: Array<{ page: number; text: string }> = [];
  let carry = startPg;
  for (const chunk of chunks) {
    const pm = chunk.match(/\[Page\s+(\d+)\]/i);
    const pg = pm ? Number(pm[1]) || carry : carry;
    carry = pg;
    segments.push({ page: pg, text: chunk });
  }
  const blocks: SectionBlock[] = [];
  let buf = "";
  let rs = segments[0]?.page ?? startPg;
  let re = segments[0]?.page ?? startPg;

  const flush = () => {
    const body = buf.trim();
    if (body.length < 24) return;
    const inline = extractInlineArrays(body);
    blocks.push({
      sectionId: `${primarySourceLabel}-pages-${rs}-${re}`,
      chapterLabel: "",
      chapterTitle: "",
      heading: `Pages ${rs}–${re}`,
      level: 9,
      startPage: rs,
      endPage: re,
      text: body.slice(0, 120_000),
      formulas: inline.formulas,
      definitions: inline.definitions,
      workedExamples: inline.workedExamples,
      proofsAndDerivations: inline.proofsAndDerivations,
      proofs: inline.proofsAndDerivations.filter((p) => /^Proof\b/i.test(p)),
      exercises: [],
      formulaCandidates: inline.formulas,
      definitionCandidates: inline.definitions,
      theoremCandidates: inline.theoremCandidates,
      proofCandidates: inline.proofCandidates,
      exampleCandidates: inline.exampleCandidates,
      exerciseCandidates: inline.exerciseCandidates,
    });
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
  return blocks.length ? blocks : [];
}

export function buildSectionBlocks(fullText: string, primarySourceLabel = "notes"): SectionBlock[] {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  const structural = collectStructuralHeadings(text);

  if (structural.length === 0) {
    const fallback = buildSectionBlocksByPageWindows(fullText, primarySourceLabel, MAX_SECTION_PAGES);
    if (fallback.length) return fallback;
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

    const spans = splitByPageBudget(text, body, MAX_SECTION_PAGES);
    for (let part = 0; part < spans.length; part += 1) {
      const span = spans[part]!;
      const secInline = extractInlineArrays(span.slice);
      const sectionId =
        spans.length > 1 ?
          `${primarySourceLabel}-${headingKey(h, i)}-p${part + 1}`
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
        formulaCandidates: secInline.formulas,
        definitionCandidates: secInline.definitions,
        theoremCandidates: secInline.theoremCandidates,
        proofCandidates: secInline.proofCandidates,
        exampleCandidates: secInline.exampleCandidates,
        exerciseCandidates: secInline.exerciseCandidates,
      });
    }
  }

  const deduped = dedupeBlocks(blocks);
  const wholeOnly =
    deduped.length === 1 && /whole$/i.test(deduped[0]?.sectionId ?? "") && deduped[0]!.endPage - deduped[0]!.startPage >= MAX_SECTION_PAGES;
  if (wholeOnly) {
    const split = buildSectionBlocksByPageWindows(fullText, primarySourceLabel, MAX_SECTION_PAGES);
    if (split.length > 1) return split;
  }
  return deduped;
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

/** Long notes should not be one giant extraction slab when structure is missing (local-first QA). */
export function ensureMinimumSectionBlocksForLongNotes(
  blocks: SectionBlock[],
  fullText: string,
  primarySourceLabel: string,
  pageCount: number,
  headingCandidateCount?: number,
): SectionBlock[] {
  const pageChunkNamed = blocks.length > 0 && blocks.every((b) => /^Pages\s+\d+/i.test(b.heading) || (b.level ?? 0) >= 9);
  if (
    headingCandidateCount != null &&
    headingCandidateCount >= 4 &&
    blocks.length >= 3 &&
    !pageChunkNamed
  ) {
    return blocks;
  }
  if (pageCount <= 30 || blocks.length >= 10) return blocks;
  const target = Math.max(5, Math.min(30, Math.ceil(pageCount / 7)));
  const maxPages = Math.max(4, Math.ceil(pageCount / target));
  const split = buildSectionBlocksByPageWindows(fullText, primarySourceLabel, maxPages);
  return split.length >= 5 ? split : blocks;
}

function pagesAsSegments(fullText: string): Array<{ page: number; text: string }> {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  if (!/\[Page\s+\d+\]/i.test(text)) {
    return [{ page: 1, text }];
  }
  const chunks = text.split(/(?=\n\[Page\s+\d+\])/);
  const out: Array<{ page: number; text: string }> = [];
  let carry = 1;
  for (const chunk of chunks) {
    const pm = chunk.match(/\[Page\s+(\d+)\]/i);
    const pg = pm ? Number(pm[1]) || carry : carry;
    carry = pg;
    out.push({ page: pg, text: chunk });
  }
  return out;
}

function sliceTextForPageRange(fullText: string, startPage: number, endPage: number, pageCount: number): string {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  if (!/\[Page\s+\d+\]/i.test(text) && pageCount > 1) {
    const len = text.length;
    const start = Math.max(0, Math.floor(((startPage - 1) / pageCount) * len));
    const end = Math.min(len, Math.ceil((endPage / pageCount) * len));
    return text.slice(start, Math.max(start + 40, end)).slice(0, 120_000);
  }
  const segs = pagesAsSegments(fullText);
  return segs
    .filter((s) => s.page >= startPage && s.page <= endPage)
    .map((s) => s.text)
    .join("\n")
    .trim()
    .slice(0, 120_000);
}

/** One block per TOC row — primary segmentation path when {@link ChapterMapEntry} spans exist. */
export function buildSectionBlocksFromChapterMap(
  fullText: string,
  chapters: ChapterMapEntry[],
  primarySourceLabel: string,
  pageCount: number,
): SectionBlock[] {
  if (!chapters.length) return [];
  const blocks: SectionBlock[] = [];
  let idx = 0;
  for (const ch of chapters) {
    idx += 1;
    const body = sliceTextForPageRange(fullText, ch.startPage, ch.endPage, pageCount);
    if (body.length < 8) continue;
    const inline = extractInlineArrays(body);
    blocks.push({
      sectionId: `${primarySourceLabel}-ch-${ch.chapterLabel}-${idx}`,
      chapterLabel: ch.chapterLabel,
      chapterTitle: ch.chapterTitle,
      heading: `${ch.chapterLabel} ${ch.chapterTitle}`.trim(),
      level: 2,
      startPage: ch.startPage,
      endPage: ch.endPage,
      text: body,
      formulas: inline.formulas,
      definitions: inline.definitions,
      workedExamples: inline.workedExamples,
      proofsAndDerivations: inline.proofsAndDerivations,
      proofs: inline.proofsAndDerivations.filter((p) => /^Proof\b/i.test(p)),
      exercises: [],
      formulaCandidates: inline.formulas,
      definitionCandidates: inline.definitions,
      theoremCandidates: inline.theoremCandidates,
      proofCandidates: inline.proofCandidates,
      exampleCandidates: inline.exampleCandidates,
      exerciseCandidates: inline.exerciseCandidates,
    });
  }
  return blocks.length ? dedupeBlocks(blocks) : [];
}

/** Inclusive start line, exclusive end line (end heading line starts the next block). */
export function slicePrintedLinesRange(
  pages: PageRecord[],
  start: { pageNumber: number; lineIndex: number },
  end: { pageNumber: number; lineIndex: number },
): string {
  const chunks: string[] = [];
  for (const p of pages) {
    if (p.pageNumber < start.pageNumber || p.pageNumber > end.pageNumber) continue;
    const lines = p.printedText.split("\n");
    let from = 0;
    let to = lines.length;
    if (p.pageNumber === start.pageNumber) from = Math.min(Math.max(0, start.lineIndex), lines.length);
    if (p.pageNumber === end.pageNumber) {
      to = Math.min(Math.max(0, end.lineIndex), lines.length);
    } else if (p.pageNumber === start.pageNumber && start.pageNumber < end.pageNumber) {
      to = lines.length;
    }
    const part = lines.slice(from, to).join("\n");
    if (part.trim()) chunks.push(`[Page ${p.pageNumber}]`, part);
  }
  return chunks.join("\n\n").trim();
}

/** Shorten chapter spans when a later "Chapter N" marker appears before the TOC-derived end page. */
export function reconcileChapterMapEnds(
  map: ChapterMapEntry[],
  headings: HeadingCandidate[],
): ChapterMapEntry[] {
  const markers = headings
    .filter((h) => /^Chapter\s*\d+/i.test(h.text.trim()))
    .map((h) => ({
      n: Number(/^Chapter\s*(\d+)/i.exec(h.text.trim())?.[1]),
      p: h.pageNumber,
    }))
    .filter((x) => Number.isFinite(x.n) && x.n > 0)
    .sort((a, b) => a.p - b.p || a.n - b.n);

  return map.map((ch) => {
    const myN = Number(String(ch.chapterLabel).replace(/\D/g, "") || 0);
    if (!myN) return ch;
    const nextMk = markers.find((m) => m.n > myN && m.p > ch.startPage);
    if (!nextMk || nextMk.p > ch.endPage) return ch;
    const end = Math.min(ch.endPage, Math.max(ch.startPage, nextMk.p - 1));
    return { ...ch, endPage: end };
  });
}

/**
 * Page-aware section blocks: slice directly from {@link PageRecord}s — avoids blind combinedText slicing.
 */
export function buildSectionBlocksPageAware(
  chapterMap: ChapterMapEntry[],
  headings: HeadingCandidate[],
  pages: PageRecord[],
  primarySourceLabel: string,
): SectionBlock[] {
  if (!chapterMap.length || !pages.length) return [];

  const blocks: SectionBlock[] = [];
  let blockIdx = 0;

  const innerHeadingsForChapter = (ch: ChapterMapEntry) =>
    headings
      .filter((h) => h.pageNumber >= ch.startPage && h.pageNumber <= ch.endPage)
      .filter((h) => {
        if (h.headingType !== "chapter") return true;
        const m = h.text.match(/^Chapter\s*(\d+)/i);
        if (!m) return true;
        const hn = Number(m[1]);
        const myNum = Number(String(ch.chapterLabel).replace(/\D/g, "") || -1);
        if (myNum < 0) return true;
        if (hn > myNum) return true;
        if (hn < myNum) return false;
        const rest = h.text.replace(/^Chapter\s*\d+\s*/i, "").trim();
        return rest.length >= 4;
      })
      .sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex);

  const sectionLikeFallback = (ch: ChapterMapEntry) =>
    headings
      .filter((h) => h.pageNumber >= ch.startPage && h.pageNumber <= ch.endPage)
      .filter(
        (h) =>
          h.headingType === "section" ||
          h.headingType === "subsection" ||
          h.headingType === "subsubsection" ||
          h.headingType === "theorem" ||
          h.headingType === "definition" ||
          h.headingType === "lemma" ||
          h.headingType === "proposition" ||
          h.headingType === "corollary" ||
          h.headingType === "example" ||
          h.headingType === "worked_example",
      )
      .sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex);

  const lastLineOnPage = (pageNum: number): number => {
    const pg = pages.find((p) => p.pageNumber === pageNum);
    return pg ? pg.printedText.split("\n").length : 0;
  };

  const fixedMap = reconcileChapterMapEnds(chapterMap, headings);

  for (const ch of fixedMap) {
    let inner = innerHeadingsForChapter(ch);
    if (inner.length < 2) {
      const fb = sectionLikeFallback(ch);
      if (fb.length >= 2) inner = fb;
    }
    if (inner.length < 2) {
      const body = slicePageRecordsToMarkedText(pages, ch.startPage, ch.endPage);
      if (body.length < 12) continue;
      blockIdx += 1;
      const inline = extractInlineArrays(body);
      blocks.push({
        sectionId: `${primarySourceLabel}-ch-${ch.chapterLabel}-${blockIdx}`,
        chapterLabel: ch.chapterLabel,
        chapterTitle: ch.chapterTitle,
        heading: `${ch.chapterLabel} ${ch.chapterTitle}`.trim(),
        level: 2,
        startPage: ch.startPage,
        endPage: ch.endPage,
        text: body.slice(0, 120_000),
        formulas: inline.formulas,
        definitions: inline.definitions,
        workedExamples: inline.workedExamples,
        proofsAndDerivations: inline.proofsAndDerivations,
        proofs: inline.proofsAndDerivations.filter((p) => /^Proof\b/i.test(p)),
        exercises: [],
        formulaCandidates: inline.formulas,
        definitionCandidates: inline.definitions,
        theoremCandidates: inline.theoremCandidates,
        proofCandidates: inline.proofCandidates,
        exampleCandidates: inline.exampleCandidates,
        exerciseCandidates: inline.exerciseCandidates,
      });
      continue;
    }

    for (let i = 0; i < inner.length; i += 1) {
      const cur = inner[i]!;
      const next = inner[i + 1];
      const start = { pageNumber: cur.pageNumber, lineIndex: cur.lineIndex };
      const end = next ?
        { pageNumber: next.pageNumber, lineIndex: next.lineIndex }
      : { pageNumber: ch.endPage, lineIndex: lastLineOnPage(ch.endPage) };
      const body = slicePrintedLinesRange(pages, start, end);
      if (body.length < 12) continue;
      blockIdx += 1;
      const inline = extractInlineArrays(body);
      blocks.push({
        sectionId: `${primarySourceLabel}-${ch.chapterLabel}-h${blockIdx}`,
        chapterLabel: ch.chapterLabel,
        chapterTitle: ch.chapterTitle,
        heading: cur.text.slice(0, 220),
        level: cur.level,
        startPage: cur.pageNumber,
        endPage: next ?
          (next.pageNumber > cur.pageNumber ? next.pageNumber - 1 : cur.pageNumber)
        : ch.endPage,
        startLineIndex: cur.lineIndex,
        endLineIndex: next?.lineIndex,
        text: body.slice(0, 120_000),
        formulas: inline.formulas,
        definitions: inline.definitions,
        workedExamples: inline.workedExamples,
        proofsAndDerivations: inline.proofsAndDerivations,
        proofs: inline.proofsAndDerivations.filter((p) => /^Proof\b/i.test(p)),
        exercises: [],
        formulaCandidates: inline.formulas,
        definitionCandidates: inline.definitions,
        theoremCandidates: inline.theoremCandidates,
        proofCandidates: inline.proofCandidates,
        exampleCandidates: inline.exampleCandidates,
        exerciseCandidates: inline.exerciseCandidates,
      });
    }
  }

  return dedupeBlocks(blocks).slice(0, 500);
}

function lastPrintedLineIndexOnPage(pages: PageRecord[], pageNum: number): number {
  const pg = pages.find((p) => p.pageNumber === pageNum);
  return pg ? pg.printedText.split("\n").length : 0;
}

/**
 * Primary path: {@link HeadingCandidate} list → blocks end at the next heading of equal or higher priority
 * (same or lower numeric {@link HeadingCandidate.level}). Uses {@link slicePrintedLinesRange} only (no blind offsets).
 */
export function buildSemanticSectionBlocksFromHeadingCandidates(
  pages: PageRecord[],
  headings: HeadingCandidate[],
  chapterMap: ChapterMapEntry[],
  primarySourceLabel: string,
): SectionBlock[] {
  if (!pages.length || headings.length < 1) return [];
  const sorted = [...headings].sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex || a.text.localeCompare(b.text));
  const lastPg = pages[pages.length - 1]!.pageNumber;

  const ctxChapter = (pg: number) => {
    const ch = chapterMap.find((c) => pg >= c.startPage && pg <= c.endPage);
    return ch ? { chapterLabel: ch.chapterLabel, chapterTitle: ch.chapterTitle } : { chapterLabel: "", chapterTitle: "" };
  };

  const blocks: SectionBlock[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    let nextIdx = i + 1;
    while (nextIdx < sorted.length && sorted[nextIdx]!.level > cur.level) nextIdx += 1;
    const next = sorted[nextIdx];
    const start = { pageNumber: cur.pageNumber, lineIndex: cur.lineIndex };
    const end = next ?
      { pageNumber: next.pageNumber, lineIndex: next.lineIndex }
    : { pageNumber: lastPg, lineIndex: lastPrintedLineIndexOnPage(pages, lastPg) };
    const body = slicePrintedLinesRange(pages, start, end);
    if (body.length < 8) continue;

    let parentSection: string | undefined;
    for (let k = i - 1; k >= 0; k -= 1) {
      const h = sorted[k]!;
      if (h.level < cur.level && ["chapter", "section", "subsection", "subsubsection"].includes(h.headingType)) {
        parentSection = h.text.replace(/\s+/g, " ").trim().slice(0, 180);
        break;
      }
    }

    const childHeadings: string[] = [];
    for (let k = i + 1; k < nextIdx; k += 1) {
      const h = sorted[k]!;
      if (h.level > cur.level) childHeadings.push(h.text.replace(/\s+/g, " ").trim().slice(0, 120));
    }

    const inline = extractInlineArrays(body);
    const ctx = ctxChapter(cur.pageNumber);
    const sectionId = `${primarySourceLabel}-sem-${i}-${cur.pageNumber}-${cur.lineIndex}`;

    blocks.push({
      sectionId,
      chapterLabel: ctx.chapterLabel,
      chapterTitle: ctx.chapterTitle,
      heading: cur.text.replace(/\s+/g, " ").trim().slice(0, 220),
      headingType: cur.headingType,
      level: cur.level,
      parentSection,
      childHeadings: childHeadings.slice(0, 32),
      candidateCounts: {
        formulas: inline.formulas.length,
        definitions: inline.definitions.length,
        proofs: inline.proofCandidates.length,
        examples: inline.exampleCandidates.length,
      },
      startPage: cur.pageNumber,
      endPage: next ? (next.pageNumber > cur.pageNumber ? next.pageNumber - 1 : cur.pageNumber) : lastPg,
      startLineIndex: cur.lineIndex,
      endLineIndex: next?.lineIndex,
      text: body.slice(0, 120_000),
      formulas: inline.formulas,
      definitions: inline.definitions,
      workedExamples: inline.workedExamples,
      proofsAndDerivations: inline.proofsAndDerivations,
      proofs: inline.proofsAndDerivations.filter((p) => /^Proof\b/i.test(p)),
      exercises: [],
      formulaCandidates: inline.formulas,
      definitionCandidates: inline.definitions,
      theoremCandidates: inline.theoremCandidates,
      proofCandidates: inline.proofCandidates,
      exampleCandidates: inline.exampleCandidates,
      exerciseCandidates: inline.exerciseCandidates,
    });
  }
  return dedupeBlocks(blocks);
}

/**
 * One section block per heading candidate (page/line bounded). Use when chapter map is coarse
 * but academic headings are dense — keeps long notes from collapsing to a handful of slabs.
 */
export function buildSectionBlocksFromHeadingGraph(
  pages: PageRecord[],
  headings: HeadingCandidate[],
  primarySourceLabel: string,
  chapterMap: ChapterMapEntry[],
): SectionBlock[] {
  if (!pages.length || headings.length < 2) return [];
  const sorted = [...headings].sort((a, b) => a.pageNumber - b.pageNumber || a.lineIndex - b.lineIndex);
  const uniq: HeadingCandidate[] = [];
  let prevKey = "";
  for (const h of sorted) {
    const k = `${h.pageNumber}|${h.lineIndex}|${h.normalizedText}`;
    if (k === prevKey) continue;
    prevKey = k;
    uniq.push(h);
  }

  const ctxForPage = (pg: number) => {
    const ch = chapterMap.find((c) => pg >= c.startPage && pg <= c.endPage);
    return ch ? { chapterLabel: ch.chapterLabel, chapterTitle: ch.chapterTitle } : { chapterLabel: "", chapterTitle: "" };
  };

  const blocks: SectionBlock[] = [];
  const lastPg = pages[pages.length - 1]?.pageNumber ?? 1;

  for (let i = 0; i < uniq.length; i += 1) {
    const cur = uniq[i]!;
    let nextIdx = i + 1;
    while (nextIdx < uniq.length && uniq[nextIdx]!.level > cur.level) {
      nextIdx += 1;
    }
    const next = uniq[nextIdx];
    const start = { pageNumber: cur.pageNumber, lineIndex: cur.lineIndex };
    const end = next ?
      { pageNumber: next.pageNumber, lineIndex: next.lineIndex }
    : { pageNumber: lastPg, lineIndex: lastPrintedLineIndexOnPage(pages, lastPg) };
    const body = slicePrintedLinesRange(pages, start, end);
    if (body.length < 10) continue;
    const inline = extractInlineArrays(body);
    const ctx = ctxForPage(cur.pageNumber);
    const headingShort = cur.text.replace(/\s+/g, " ").trim().slice(0, 180);
    blocks.push({
      sectionId: `${primarySourceLabel}-hg-${i}-${cur.pageNumber}`,
      chapterLabel: ctx.chapterLabel,
      chapterTitle: ctx.chapterTitle,
      heading: headingShort,
      level: cur.level,
      startPage: cur.pageNumber,
      endPage: next ? (next.pageNumber > cur.pageNumber ? next.pageNumber - 1 : cur.pageNumber) : lastPg,
      startLineIndex: cur.lineIndex,
      endLineIndex: next?.lineIndex,
      text: body.slice(0, 120_000),
      formulas: inline.formulas,
      definitions: inline.definitions,
      workedExamples: inline.workedExamples,
      proofsAndDerivations: inline.proofsAndDerivations,
      proofs: inline.proofsAndDerivations.filter((p) => /^Proof\b/i.test(p)),
      exercises: [],
      formulaCandidates: inline.formulas,
      definitionCandidates: inline.definitions,
      theoremCandidates: inline.theoremCandidates,
      proofCandidates: inline.proofCandidates,
      exampleCandidates: inline.exampleCandidates,
      exerciseCandidates: inline.exerciseCandidates,
    });
  }
  return dedupeBlocks(blocks);
}
