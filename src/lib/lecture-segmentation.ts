/**
 * Page-aware structural heading detection for long lecture PDFs.
 * Works with `[Page N]` markers inserted by the PDF parser.
 */

export type StructuralHeadingKind = "chapter" | "section";

export type StructuralHeading = {
  kind: StructuralHeadingKind;
  /** e.g. "1", "Chapter 1", "2.3", "2.3.1" */
  label: string;
  /** Human-readable heading without the number prefix */
  title: string;
  /** Full heading line */
  line: string;
  startOffset: number;
  /** 1 = chapter, 2 = N.N, 3 = N.N.N */
  level: number;
  startPage: number;
};

const PAGE_AT = /\[Page\s+(\d+)\]/gi;

export function pageAtOffset(fullText: string, offset: number): number {
  let page = 1;
  PAGE_AT.lastIndex = 0;
  for (const m of fullText.matchAll(PAGE_AT)) {
    if ((m.index ?? 0) > offset) break;
    page = Number(m[1]) || page;
  }
  return page;
}

/**
 * Collect Chapter lines and numbered section headings (N.N, N.N.N).
 * Skips citation-broken lines and obvious noise years.
 */
export function collectStructuralHeadings(fullText: string): StructuralHeading[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const out: StructuralHeading[] = [];

  const push = (h: Omit<StructuralHeading, "startPage">) => {
    out.push({ ...h, startPage: pageAtOffset(text, h.startOffset) });
  };

  let offset = 0;
  for (const rawLine of text.split("\n")) {
    const lineStart = offset;
    const trimLead = rawLine.length - rawLine.trimStart().length;
    const t = rawLine.trim();
    offset += rawLine.length + 1;

    if (t.length < 8) continue;
    const contentStart = lineStart + trimLead;

    const ch = t.match(/^Chapter\s+(\d{1,2}(?:\.\d+)?)\s*[.:]?\s+(.+)/i);
    if (ch) {
      const title = truncateTitle((ch[2] ?? "").replace(/\s+/g, " ").trim());
      if (title.length >= 4) {
        push({
          kind: "chapter",
          label: `Chapter ${ch[1]}`,
          title,
          line: t.slice(0, 240),
          startOffset: contentStart,
          level: 1,
        });
      }
      continue;
    }

    const sec = t.match(/^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+([A-Za-z\u00C0-\u024F].+)/);
    if (sec) {
      const num = sec[1] ?? "";
      const title = truncateTitle((sec[2] ?? "").replace(/\s+/g, " ").trim());
      if (title.length < 4) continue;
      if (/^(Definition|Theorem|Lemma|Proposition|Corollary|Remark|Example|Exercise|Proof|Algorithm)\b/i.test(title)) continue;
      if (isLikelyYearOrNoise(num, title)) continue;
      const parts = num.split(".").length;
      const level = parts <= 2 ? 2 : 3;
      push({
        kind: "section",
        label: num,
        title,
        line: t.slice(0, 240),
        startOffset: contentStart,
        level,
      });
    }
  }

  out.sort((a, b) => a.startOffset - b.startOffset || a.level - b.level);
  return dedupeHeadings(out);
}

function truncateTitle(t: string): string {
  const stop = /\b(we introduce|we consider|recall that|this section|let\s+\w+\s+be)\b/i.exec(t);
  if (stop && stop.index >= 12) return t.slice(0, stop.index).trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

function isLikelyYearOrNoise(sectionNum: string, title: string): boolean {
  if (/^(19|20)\d{2}$/.test(sectionNum.split(".")[0] ?? "")) return true;
  if (/^\d+\.\d+$/.test(sectionNum) && /^Exam\b|^Final\b|^Figure\b/i.test(title)) return false;
  return false;
}

function dedupeHeadings(headings: StructuralHeading[]): StructuralHeading[] {
  const seen = new Set<string>();
  const out: StructuralHeading[] = [];
  for (const h of headings) {
    const k = `${h.startOffset}|${h.line.slice(0, 120)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

export type ChapterContext = {
  chapterLabel: string;
  chapterTitle: string;
};

/** Walk headings and track most recent Chapter banner for each offset. */
export function chapterContextAt(headings: StructuralHeading[], offset: number): ChapterContext {
  let best: StructuralHeading | undefined;
  for (const h of headings) {
    if (h.kind !== "chapter") continue;
    if (h.startOffset <= offset && (!best || h.startOffset >= best.startOffset)) best = h;
  }
  if (!best) return { chapterLabel: "", chapterTitle: "" };
  const num = best.label.replace(/^chapter\s+/i, "").trim();
  return { chapterLabel: num ? `Chapter ${num}` : best.label, chapterTitle: best.title };
}
