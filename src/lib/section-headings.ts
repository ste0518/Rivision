/**
 * Shared section/chapter heading detection for parsed lecture text (PDF extraction,
 * markdown, etc.). Used by {@link finalizeParsedDocument} and the Study Pack course map.
 */

export type ExtractedSectionHeading = {
  sectionNumber: string;
  title: string;
  startOffset: number;
};

function titleCaseHeading(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return t;
  // Preserve ALL CAPS lines (chapter banners); otherwise title-case words.
  if (/^[A-Z0-9\s\-–—:,]{8,}$/.test(t) && /[A-Z]/.test(t) && !/[a-z]/.test(t)) {
    return t
      .toLowerCase()
      .replace(/\b([a-z])([a-z0-9-]*)/g, (_m, h: string, tail: string) => h.toUpperCase() + tail);
  }
  return t.replace(/\b([a-z])([a-z0-9-]*)/g, (_m, h: string, tail: string) => h.toUpperCase() + tail);
}

/** Strip merged-in body text after a section heading (PDF often puts the first sentence on the same line). */
function shortenSectionRawTitle(rawTitle: string): string {
  let t = rawTitle.replace(/\s+/g, " ").trim();
  if (!t) return t;

  const lower = t.toLowerCase();
  const stopRe =
    /\b(we introduce|we consider|we now|consider the|recall that|this section|this chapter|this suggests|let\s+\w+\s+be|suppose that|in this section|the goal of)\b/i;
  const stop = stopRe.exec(lower);
  if (stop && stop.index >= 8) t = t.slice(0, stop.index).replace(/\s+$/u, "").trim();

  // ALL-CAPS banner merged with sentence: keep only consecutive banner words.
  const words = t.split(/\s+/);
  if (words.length >= 2 && /^[A-Z0-9\-–—:]+$/.test(words[0]!) && /^[A-Z][A-Z\-–—:]+$/.test(words[1]!)) {
    const banner: string[] = [];
    for (const w of words) {
      if (/^[A-Z0-9][A-Z0-9\-–—:]*$/.test(w) && !/[a-z]/.test(w)) banner.push(w);
      else break;
    }
    if (banner.length >= 1 && banner.join(" ").length >= 6) t = banner.join(" ");
  }

  if (t.length > 90) {
    const cut = t.slice(0, 90);
    const sp = cut.lastIndexOf(" ");
    t = sp > 40 ? cut.slice(0, sp).trim() : cut.trim();
  }

  if (t.length < 4) return rawTitle.replace(/\s+/g, " ").trim().slice(0, 90);
  return t;
}

function isNoiseNumber(num: string): boolean {
  if (!num.includes(".") && num.length >= 4) return true;
  return false;
}

/**
 * Detect numbered section headings like `1 INTRODUCTION`, `1.1.2 Motivating example`,
 * optionally after page markers. Also detects standalone chapter banners:
 * digit on one line, ALL-CAPS title on the next.
 */
export function extractSectionHeadingsFromText(fullText: string): ExtractedSectionHeading[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const seen = new Set<string>();
  const out: ExtractedSectionHeading[] = [];

  const push = (sectionNumber: string, rawTitle: string, startOffset: number) => {
    const clipped = shortenSectionRawTitle(rawTitle);
    const title = titleCaseHeading(clipped);
    if (title.length < 4 || title.length > 160) return;
    if (/^(definition|theorem|lemma|proposition|corollary|remark|example|proof|algorithm|exercise)\b/i.test(title)) return;
    if (/[=∑∫∏≥≤<>]/.test(rawTitle) && rawTitle.length > 80) return;
    const key = `${sectionNumber}|${title.slice(0, 96).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sectionNumber, title, startOffset });
  };

  // Cap capture length so one line does not swallow the whole paragraph; shortenSectionRawTitle trims body glue.
  const reInline = /(?:^|\n)\s*(\d+(?:\.\d+){0,3})\s+([A-Za-z\u00C0-\u024F][^\n]{2,120})/g;
  let m: RegExpExecArray | null;
  while ((m = reInline.exec(text)) !== null) {
    const num = m[1] ?? "";
    const rawTitle = (m[2] ?? "").trim();
    if (isNoiseNumber(num)) continue;
    push(num, rawTitle, m.index ?? 0);
  }

  const reStandalone = /(?:^|\n)\s*(\d{1,2})\s*\n\s*([A-Z][A-Z\s\-–—:]{5,120})\s*(?=\n|$)/g;
  while ((m = reStandalone.exec(text)) !== null) {
    const num = m[1] ?? "";
    const rawTitle = (m[2] ?? "").trim();
    push(num, rawTitle, m.index ?? 0);
  }

  // Digit line then Title-case / mixed heading (not ALL CAPS only).
  const reStandaloneMixed = /(?:^|\n)\s*(\d{1,2}(?:\.\d+){0,3})\s*\n\s*([A-Za-z\u00C0-\u024F][^\n]{5,160})\s*(?=\n|$)/g;
  while ((m = reStandaloneMixed.exec(text)) !== null) {
    const num = m[1] ?? "";
    const rawTitle = (m[2] ?? "").trim();
    if (isNoiseNumber(num)) continue;
    push(num, rawTitle, m.index ?? 0);
  }

  // Optional period after top-level chapter index only: "3. Monte Carlo Integration"
  const reChapterDot = /(?:^|\n)\s*(\d{1,2})\.\s+([A-Za-z\u00C0-\u024F][^\n]{3,120})/g;
  while ((m = reChapterDot.exec(text)) !== null) {
    const num = m[1] ?? "";
    const rawTitle = (m[2] ?? "").trim();
    push(num, rawTitle, m.index ?? 0);
  }

  // "Chapter 3 …" banner lines (merged PDF intros).
  const reChapterWord = /(?:^|\n)\s*Chapter\s+(\d{1,2}(?:\.\d+){0,3})\s*[.:]?\s+([A-Za-z\u00C0-\u024F][^\n]{3,120})/gi;
  while ((m = reChapterWord.exec(text)) !== null) {
    const num = m[1] ?? "";
    const rawTitle = (m[2] ?? "").trim();
    if (isNoiseNumber(num)) continue;
    push(num, rawTitle, m.index ?? 0);
  }

  out.sort((a, b) => a.startOffset - b.startOffset);
  return dedupeAdjacent(out);
}

function dedupeAdjacent(sections: ExtractedSectionHeading[]): ExtractedSectionHeading[] {
  const filtered: ExtractedSectionHeading[] = [];
  for (const s of sections) {
    const prev = filtered.at(-1);
    if (prev && prev.sectionNumber === s.sectionNumber && prev.title === s.title && Math.abs(prev.startOffset - s.startOffset) < 8) {
      continue;
    }
    filtered.push(s);
  }
  return filtered.slice(0, 200);
}

function sectionNumberParts(num: string): number[] {
  return num.split(".").map((p) => {
    const n = Number.parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
}

/** Lexicographic compare: 3.10 sorts after 3.9 */
export function compareSectionNumbers(a: string, b: string): number {
  const aa = sectionNumberParts(a);
  const bb = sectionNumberParts(b);
  const len = Math.max(aa.length, bb.length);
  for (let i = 0; i < len; i += 1) {
    const da = (aa[i] ?? 0) - (bb[i] ?? 0);
    if (da !== 0) return da;
  }
  return 0;
}

/**
 * Merge headings from combined notes + per-file text (some PDFs only expose nested headings
 * clearly within a single file). Dedupe by section number; keep the richer title.
 */
export function mergeExtractedSectionHeadings(...lists: ExtractedSectionHeading[][]): ExtractedSectionHeading[] {
  const byNum = new Map<string, ExtractedSectionHeading>();
  for (const list of lists) {
    for (const s of list) {
      const prev = byNum.get(s.sectionNumber);
      if (!prev) {
        byNum.set(s.sectionNumber, s);
        continue;
      }
      const keep =
        s.title.length > prev.title.length && s.title.length <= 200
          ? s
          : prev.title.length > s.title.length && prev.title.length <= 200
            ? prev
            : s.startOffset < prev.startOffset
              ? s
              : prev;
      byNum.set(s.sectionNumber, keep);
    }
  }
  return [...byNum.values()].sort((a, b) => {
    const c = compareSectionNumbers(a.sectionNumber, b.sectionNumber);
    if (c !== 0) return c;
    return a.startOffset - b.startOffset;
  });
}

/**
 * Truncate a definition/theorem body when PDF glue merges later sections into the same block.
 * Stops before the first interior line that looks like a numbered section heading.
 */
/**
 * Index of the first interior numbered section heading (e.g. `3.3 Importance sampling`) inside `body`,
 * or undefined if none. Used to stop Example/Exercise blocks from swallowing later sections.
 */
export function findFirstInteriorSectionHeadingIndex(body: string, minOffset = 48): number | undefined {
  const text = body.replace(/\r\n/g, "\n");
  const re = /(?:^|\n)\s*(\d{1,2}(?:\.\d+){1,3})\s+([A-Za-z\u00C0-\u024F][^\n]{6,160})/g;
  let m: RegExpExecArray | null;
  let best: number | undefined;
  while ((m = re.exec(text)) !== null) {
    const idx = m.index ?? 0;
    if (idx < minOffset) continue;
    const num = m[1] ?? "";
    if (isNoiseNumber(num)) continue;
    const rawTitle = (m[2] ?? "").trim();
    if (/^(definition|theorem|lemma|proposition|corollary|remark|example|proof|algorithm|exercise)\b/i.test(rawTitle)) continue;
    if (best === undefined || idx < best) best = idx;
  }
  return best;
}

export function truncateBodyBeforeInteriorSectionHeading(body: string, minOffset = 48): string {
  const text = body.replace(/\r\n/g, "\n");
  const cut = findFirstInteriorSectionHeadingIndex(text, minOffset);
  if (cut !== undefined && cut < text.length) return text.slice(0, cut).trim();
  return body;
}
