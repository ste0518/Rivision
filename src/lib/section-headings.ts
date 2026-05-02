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
    const title = titleCaseHeading(rawTitle);
    if (title.length < 4 || title.length > 160) return;
    if (/^(definition|theorem|lemma|proposition|corollary|remark|example|proof|algorithm|exercise)\b/i.test(title)) return;
    if (/[=∑∫∏≥≤<>]/.test(rawTitle) && rawTitle.length > 80) return;
    const key = `${sectionNumber}|${title.slice(0, 96).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ sectionNumber, title, startOffset });
  };

  const reInline = /(?:^|\n)\s*(\d+(?:\.\d+){0,3})\s+([A-Za-z\u00C0-\u024F][^\n]{3,140})/g;
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
