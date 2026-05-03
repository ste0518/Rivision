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

const LABELLED_BLOCK_START =
  /^(Definition|Theorem|Lemma|Proposition|Corollary|Remark|Example|Exercise|Proof|Algorithm)\s+[\d.]/i;

function isStructuralNoiseTitle(title: string): boolean {
  return LABELLED_BLOCK_START.test(title.trim());
}

/**
 * Regex scan for numbered sections when line-by-line passes miss merged PDF lines.
 */
export function collectFallbackStructuralHeadings(fullText: string): StructuralHeading[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const out: StructuralHeading[] = [];
  const re = /(?:^|\n)\s*((?:\d{1,2}\.\d{1,2}(?:\.\d{1,2})?))\s+([^\n]{5,240})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const num = m[1] ?? "";
    const rawTitle = (m[2] ?? "").trim();
    const title = truncateTitle(rawTitle.replace(/\s+/g, " "));
    if (title.length < 4) continue;
    if (isStructuralNoiseTitle(title)) continue;
    if (isLikelyYearOrNoise(num, title)) continue;
    const idx = m.index ?? 0;
    const lineStart = text[idx] === "\n" ? idx + 1 : idx;
    const parts = num.split(".").length;
    const level = parts <= 2 ? 2 : 3;
    out.push({
      kind: "section",
      label: num,
      title,
      line: `${num} ${title}`.slice(0, 240),
      startOffset: lineStart,
      level,
      startPage: pageAtOffset(text, lineStart),
    });
  }
  return dedupeHeadings(out);
}

/**
 * Collect Chapter lines and numbered section headings (N.N, N.N.N).
 * Skips citation-broken lines and obvious noise years.
 * Merges a fallback scan so merged PDF lines still yield segment anchors.
 */
export function collectStructuralHeadings(fullText: string): StructuralHeading[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const lineStarts: number[] = [];
  let o = 0;
  for (const ln of lines) {
    lineStarts.push(o);
    o += ln.length + 1;
  }

  const out: StructuralHeading[] = [];

  const push = (h: Omit<StructuralHeading, "startPage">) => {
    out.push({ ...h, startPage: pageAtOffset(text, h.startOffset) });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? "";
    const trimLead = rawLine.length - rawLine.trimStart().length;
    const t = rawLine.trim();
    if (t.length < 4) continue;
    const contentStart = lineStarts[i]! + trimLead;

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

    const chBare = t.match(/^Chapter\s+(\d{1,2}(?:\.\d+)?)\s*$/i);
    if (chBare && i + 1 < lines.length) {
      const nextLine = (lines[i + 1] ?? "").trim();
      if (
        nextLine.length >= 4 &&
        nextLine.length < 200 &&
        !/^\[Page\b/i.test(nextLine) &&
        !/^\d+\.\d+/.test(nextLine) &&
        !/^Chapter\s+/i.test(nextLine)
      ) {
        const title = truncateTitle(nextLine.replace(/\s+/g, " "));
        if (title.length >= 4) {
          push({
            kind: "chapter",
            label: `Chapter ${chBare[1]}`,
            title,
            line: `${t} ${nextLine}`.slice(0, 240),
            startOffset: contentStart,
            level: 1,
          });
        }
      }
      continue;
    }

    const chCaps = t.match(/^CHAPTER\s+(\d{1,2}(?:\.\d+)?)\s*[.:]?\s*(.*)$/i);
    if (chCaps && (chCaps[2]?.trim().length ?? 0) >= 4) {
      const title = truncateTitle((chCaps[2] ?? "").replace(/\s+/g, " ").trim());
      push({
        kind: "chapter",
        label: `Chapter ${chCaps[1]}`,
        title,
        line: t.slice(0, 240),
        startOffset: contentStart,
        level: 1,
      });
      continue;
    }

    const sec = t.match(/^(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\s+(.+)/);
    if (sec) {
      const num = sec[1] ?? "";
      let rawTitle = (sec[2] ?? "").replace(/\s+/g, " ").trim();
      rawTitle = rawTitle.replace(/^[\s.:)-]+/, "");
      const title = truncateTitle(rawTitle);
      if (title.length < 4) continue;
      if (isStructuralNoiseTitle(title)) continue;
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
      continue;
    }

    const we = t.match(/^Worked\s+example\s*[.:]?\s*(.*)$/i);
    if (we && t.length < 220) {
      const rest = (we[1] ?? "").trim();
      const title = truncateTitle(rest.length >= 4 ? rest : "Worked example");
      push({
        kind: "section",
        label: "Worked example",
        title,
        line: t.slice(0, 240),
        startOffset: contentStart,
        level: 2,
      });
      continue;
    }

    const modelLabel = t.match(
      /^(MA|AR|ARMA|ARCH|ARIMA|VAR|GLP|General\s+linear\s+process)\s*\([^)]{1,24}\)\s*$/i,
    );
    if (modelLabel && t.length < 120) {
      push({
        kind: "section",
        label: modelLabel[1]!.toUpperCase(),
        title: t.trim(),
        line: t.slice(0, 240),
        startOffset: contentStart,
        level: 3,
      });
    }
  }

  const merged = [...out, ...collectFallbackStructuralHeadings(text)];
  merged.sort((a, b) => a.startOffset - b.startOffset || a.level - b.level);
  return dedupeHeadings(merged);
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
    const k = `${h.startOffset}|${h.kind}|${h.label}|${h.title.slice(0, 80)}`;
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
