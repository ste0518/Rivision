/**
 * Title page / cover metadata split from academic title lines (local-first).
 */

import { sanitiseExtractedText } from "@/lib/text-layers";

export type FrontMatter = {
  courseCode: string | null;
  courseName: string | null;
  title: string | null;
  term: string | null;
  instructor: string | null;
  contact: string | null;
  institution: string | null;
  department: string | null;
  adminNotes: string[];
  confidence: number;
};

const EMAIL = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/;
const ROOM = /\b(room|office)\s+[a-z]?\d{2,4}\b/i;
const BLACKBOARD = /\bblackboard\b/i;
const POSTAL = /\b(sw7|w12|postcode|postal|uk\s+\d)\b/i;

function rejectTitleLine(t: string): boolean {
  const s = t.trim();
  if (!s || s.length < 6) return true;
  if (EMAIL.test(s)) return true;
  if (ROOM.test(s) && s.length < 100) return true;
  if (BLACKBOARD.test(s)) return true;
  if (/\bassessment\b/i.test(s) && s.length < 140) return true;
  if (/\bcourse\s+materials\b/i.test(s)) return true;
  if (/^(department|faculty|school)\s+of\b/i.test(s)) return true;
  if (/\b(lecture\s+notes|module\s+handout)\b/i.test(s) && s.length < 36) return true;
  if (/^(professor|prof\.|dr\.)\s+/i.test(s)) return true;
  if (POSTAL.test(s)) return true;
  if (/^\[page\b/i.test(s)) return true;
  return false;
}

/** e.g. MATH60046, CS101, STAT 70012 */
const CODE_LIKE = /\b([A-Z]{2,10}\d{3,6}[A-Z]?|[A-Z]{3,10}\s*\d{3,6}[A-Z]?)\b/;

/**
 * Parse the first few pages into structured front matter vs clean academic title.
 */
export function extractFrontMatter(pages: Array<{ pageNumber: number; text: string }>, maxPages = 8): FrontMatter {
  const adminNotes: string[] = [];
  let courseCode: string | null = null;
  let courseName: string | null = null;
  let title: string | null = null;
  let term: string | null = null;
  let instructor: string | null = null;
  let contact: string | null = null;
  let institution: string | null = null;
  let department: string | null = null;

  const early = pages
    .filter((p) => p.pageNumber >= 1 && p.pageNumber <= maxPages)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  for (const p of early) {
    const raw = sanitiseExtractedText(p.text.replace(/\r\n/g, "\n"));
    for (const line of raw.split("\n")) {
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
      if (BLACKBOARD.test(t) || /\bassessment\b/i.test(t) || /\bcourse\s+materials\b/i.test(t)) {
        adminNotes.push(t);
        continue;
      }

      if (!title && !rejectTitleLine(t) && t.length >= 10 && t.length <= 160) {
        const cutDept = t.replace(/\s+/g, " ").replace(/\b(Department|Faculty)\s+of[\s\S]+$/i, "").trim();
        title = cutDept.length >= 10 ? cutDept : t;
        courseName = courseName ?? title;
      } else if (title && !courseName && !rejectTitleLine(t) && t.length >= 10 && t.length <= 160) {
        courseName = t.replace(/\s+/g, " ").trim();
      }
    }
  }

  const confidence =
    title ? 0.55 + (courseCode ? 0.15 : 0) + (term ? 0.1 : 0) + (courseName && courseName !== title ? 0.08 : 0) : adminNotes.length ? 0.25 : 0.15;

  return {
    courseCode,
    courseName: courseName ?? title,
    title,
    term,
    instructor,
    contact,
    institution,
    department,
    adminNotes: adminNotes.slice(0, 24),
    confidence: Math.min(0.95, confidence),
  };
}
