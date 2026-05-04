/**
 * Title page / cover metadata split from academic title lines (local-first).
 */

import { sanitiseExtractedText } from "@/lib/text-layers";

export type FrontMatter = {
  courseCode: string | null;
  courseName: string | null;
  /** Primary document / module title (concise). */
  documentTitle: string | null;
  /** @deprecated Prefer {@link documentTitle} — retained for callers using `.title`. */
  title: string | null;
  /** When the first major chapter banner is the best structural label (chapter PDFs). */
  chapterLabel: string | null;
  chapterTitle: string | null;
  term: string | null;
  instructor: string | null;
  contact: string | null;
  institution: string | null;
  department: string | null;
  adminNotes: string[];
  /** Overall extraction confidence for front-matter block. */
  confidence: number;
  /** Page where {@link documentTitle} was taken from (1-based). */
  titleSourcePage: number | null;
  /** 0–1 confidence specifically for the title choice. */
  titleConfidence: number;
};

const EMAIL = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const ROOM = /\b(room|office)\s+[a-z]?\d{2,4}\b/i;
const MOODLE = /\b(moodle|blackboard|canvas)\b/i;
const POSTAL = /\b(sw7|w12|postcode|postal|uk\s+\d)\b/i;
const FIGURE_TABLE_REF = /^(figure|fig\.|table)\s+\d+/i;

function rejectTitleLine(t: string): boolean {
  const s = t.trim();
  if (!s || s.length < 6) return true;
  if (EMAIL.test(s)) return true;
  if (ROOM.test(s) && s.length < 100) return true;
  if (MOODLE.test(s)) return true;
  if (/\bassessment\b/i.test(s) && s.length < 160) return true;
  if (/\bcourse\s+materials\b/i.test(s)) return true;
  if (/^(department|faculty|school)\s+of\b/i.test(s)) return true;
  if (/\b(lecture\s+notes|module\s+handout)\b/i.test(s) && s.length < 42) return true;
  if (/^(professor|prof\.|dr\.)\s+/i.test(s)) return true;
  if (POSTAL.test(s)) return true;
  if (/^\[page\b/i.test(s)) return true;
  if (FIGURE_TABLE_REF.test(s)) return true;
  if (/\b(marks?|minutes\s+allowed|total\s+marks)\b/i.test(s) && s.length < 120) return true;
  if (/^(instructions|answer\s+all|attempt)\b/i.test(s)) return true;
  return false;
}

/** e.g. MATH60046, CS101, STAT 70012 */
const CODE_LIKE = /\b([A-Z]{2,10}\d{3,6}[A-Z]?|[A-Z]{3,10}\s*\d{3,6}[A-Z]?)\b/;

function parseChapterBanner(line: string): { label: string; title: string } | null {
  const t = line.replace(/\s+/g, " ").trim();
  const ch = t.match(/^Chapter\s*(\d+(?:\.\d+)?)\s*[.:]?\s*(.*)$/i);
  if (ch) {
    const rest = (ch[2] ?? "").trim();
    return { label: ch[1] ?? "", title: rest || `Chapter ${ch[1]}` };
  }
  const num = t.match(/^(\d{1,2})\s+([A-Z0-9][^\n]{3,120})$/);
  if (num && !/^\d+\.\d/.test(t)) {
    return { label: num[1] ?? "", title: (num[2] ?? "").trim() };
  }
  return null;
}

/**
 * Parse the first few pages into structured front matter vs clean academic title.
 * Does not let later section headings replace an earlier valid title.
 */
export function extractFrontMatter(pages: Array<{ pageNumber: number; text: string }>, maxPages = 8): FrontMatter {
  const adminNotes: string[] = [];
  let courseCode: string | null = null;
  let courseName: string | null = null;
  let documentTitle: string | null = null;
  let titleSourcePage: number | null = null;
  let chapterLabel: string | null = null;
  let chapterTitle: string | null = null;
  let term: string | null = null;
  let instructor: string | null = null;
  let contact: string | null = null;
  let institution: string | null = null;
  let department: string | null = null;

  const early = pages
    .filter((p) => p.pageNumber >= 1 && p.pageNumber <= maxPages)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const considerTitle = (rawLine: string, pageNumber: number): boolean => {
    const t = rawLine.replace(/\s+/g, " ").trim();
    if (!t || rejectTitleLine(t)) return false;
    if (t.length > 160) return false;
    if (/^\d+\.\d+\s+\S/.test(t)) return false;
    if (/^(theorem|lemma|proposition|definition|example|exercise)\s+\d/i.test(t)) return false;
    const cutDept = t.replace(/\s+/g, " ").replace(/\b(Department|Faculty)\s+of[\s\S]+$/i, "").trim();
    const candidate = cutDept.length >= 10 ? cutDept : t;
    if (candidate.length < 10) return false;
    documentTitle = candidate.slice(0, 120);
    titleSourcePage = pageNumber;
    courseName = courseName ?? documentTitle;
    return true;
  };

  for (const p of early) {
    const raw = sanitiseExtractedText(p.text.replace(/\r\n/g, "\n"));
    const lines = raw.split("\n");
    for (let li = 0; li < lines.length; li += 1) {
      const line = lines[li]!;
      const t = line.trim();
      if (!t) continue;

      const cm = t.match(CODE_LIKE);
      if (cm && !courseCode) courseCode = cm[1]!.replace(/\s+/g, "").toUpperCase();

      if (/^(department|faculty|school)\s+of\b/i.test(t)) {
        department = t.replace(/\s+/g, " ").trim();
        adminNotes.push(t);
        continue;
      }
      if (/^(imperial|university|college)\b/i.test(t) && t.length < 120) {
        institution = institution ?? t.replace(/\s+/g, " ").trim();
        adminNotes.push(t);
        continue;
      }
      if (EMAIL.test(t)) {
        contact = contact ?? t;
        adminNotes.push(t);
        continue;
      }
      if (/^(professor|prof\.|dr\.)\s+/i.test(t)) {
        instructor = instructor ?? t.replace(/\s+/g, " ").trim();
        adminNotes.push(t);
        continue;
      }
      if (/\b(autumn|spring|summer|winter|term)\s+\d{4}\b/i.test(t) || /\b20\d{2}\s*[-–]\s*20\d{2}\b/.test(t)) {
        term = term ?? t.replace(/\s+/g, " ").trim();
      }
      if (MOODLE.test(t) || /\bassessment\b/i.test(t) || /\bcourse\s+materials\b/i.test(t)) {
        adminNotes.push(t);
        continue;
      }

      const ch = parseChapterBanner(t);
      if (ch && !chapterLabel) {
        chapterLabel = ch.label;
        chapterTitle = ch.title.replace(/\s+/g, " ").trim().slice(0, 120);
      }

      /** "Chapter 3" on one line and title on the next */
      if (/^Chapter\s*\d+(?:\.\d+)?\s*$/i.test(t) && li + 1 < lines.length) {
        const next = lines[li + 1]?.trim() ?? "";
        if (next.length >= 6 && next.length < 120 && !rejectTitleLine(next) && !/^\d+\.\d+/.test(next)) {
          const label = t.match(/^Chapter\s*(\d+)/i)?.[1] ?? "";
          if (!chapterLabel) chapterLabel = label;
          if (!chapterTitle) chapterTitle = next.replace(/\s+/g, " ").trim().slice(0, 120);
        }
      }

      if (!documentTitle) {
        considerTitle(t, p.pageNumber);
      } else if (!courseName || courseName === documentTitle) {
        const maybe = t.replace(/\s+/g, " ").trim();
        if (!rejectTitleLine(maybe) && maybe.length >= 12 && maybe.length <= 140 && !/^\d+\.\d+\s/.test(maybe)) {
          courseName = maybe;
        }
      }
    }
  }

  const titleConfidence =
    documentTitle ? 0.55 + (courseCode ? 0.12 : 0) + (term ? 0.1 : 0) + (chapterTitle ? 0.06 : 0) : adminNotes.length ? 0.22 : 0.12;

  const confidence = Math.min(
    0.95,
    titleConfidence + (courseCode ? 0.05 : 0) + (institution ? 0.03 : 0),
  );

  return {
    courseCode,
    courseName: courseName ?? documentTitle,
    documentTitle,
    title: documentTitle,
    chapterLabel,
    chapterTitle,
    term,
    instructor,
    contact,
    institution,
    department,
    adminNotes: adminNotes.slice(0, 24),
    confidence,
    titleSourcePage,
    titleConfidence: Math.min(0.95, titleConfidence),
  };
}
