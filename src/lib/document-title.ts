/**
 * Course / document title from early pages only (no filename fallbacks here).
 * Used by document profiling for local-first revision packs.
 */

import { sanitiseExtractedText } from "@/lib/text-layers";

const DEPARTMENT_LINE =
  /^(department|faculty|school|institute)\s+of\b/i;
const UNI_LINE = /^(imperial|university|college|london|oxford|cambridge|mit|harvard)\b/i;
const BOILERPLATE = /^(lecture\s+notes|module\s+handout|course\s+notes|autumn|spring|summer|term|year|20\d{2})/i;
const MODULE_CODE = /\b([A-Z]{2,6}\s*\d{3,5}[A-Z]?)\b/;

function skipLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t.length < 4) return true;
  if (/^\[Page\s*\d+/i.test(t) || /^\[Source\b/i.test(t)) return true;
  if (DEPARTMENT_LINE.test(t) && t.length < 100) return true;
  if (UNI_LINE.test(t) && t.length < 100) return true;
  if (/^contents?$/i.test(t) || /^table\s+of\s+contents$/i.test(t)) return true;
  if (/^module\s+code/i.test(t) || /^credits?[:]/i.test(t)) return true;
  if (/^version\s+\d/i.test(t) || /^last\s+updated/i.test(t)) return true;
  if (/^chapter\s+\d+/i.test(t)) return true;
  if (/^section\s+\d+/i.test(t)) return true;
  if (/^page\s+\d+\s+of\s+\d+/i.test(t)) return true;
  return false;
}

function cutAffiliationSuffix(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  const idx = t.search(/\b(Department|Faculty|School|Institute)\s+of\b/i);
  if (idx > 10) t = t.slice(0, idx).trim();
  const prof = t.search(/\b(Professor|Prof\.|Dr\.)\s+[A-Z]/i);
  if (prof > 12) t = t.slice(0, prof).trim();
  return t.replace(/[,\s–-]+$/u, "").trim();
}

function looksLikeTitleLine(t: string): boolean {
  if (t.length < 8 || t.length > 180) return false;
  if (t.split(/\s+/).length > 22) return false;
  if ((t.match(/=/g) ?? []).length >= 2) return false;
  if ((t.match(/[∫∑∏√∂∇]/g) ?? []).length >= 2 && t.length > 40) return false;
  if (/\b(theorem|lemma|proposition|definition)\s+\d/i.test(t)) return false;
  if (/^\d+\.\d+/.test(t)) return false;
  if (BOILERPLATE.test(t) && t.length < 30) return false;
  const letters = (t.match(/[A-Za-z]/g) ?? []).length;
  if (letters / Math.max(1, t.length) < 0.45) return false;
  return true;
}

/**
 * Derive display title and course name from the first few pages of extracted text
 * (per-page array — no dependency on combinedText markers).
 */
export function inferTitleAndCourseFromEarlyPages(
  cleanedPages: Array<{ pageNumber: number; text: string }>,
  maxPage = 8,
): { title: string | null; courseName: string | null; confidence: number; sourcePage: number | null } {
  if (!cleanedPages.length) {
    return { title: null, courseName: null, confidence: 0, sourcePage: null };
  }

  const early = cleanedPages
    .filter((p) => p.pageNumber >= 1 && p.pageNumber <= maxPage)
    .sort((a, b) => a.pageNumber - b.pageNumber);

  const lines: { text: string; page: number }[] = [];
  for (const p of early) {
    const raw = sanitiseExtractedText(p.text.replace(/\r\n/g, "\n"));
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      lines.push({ text: t, page: p.pageNumber });
    }
  }

  const candidates: { text: string; page: number; score: number }[] = [];
  for (const { text, page } of lines) {
    if (skipLine(text)) continue;
    const cleaned = cutAffiliationSuffix(text);
    if (!looksLikeTitleLine(cleaned)) continue;
    let score = 3;
    if (cleaned.length >= 16 && cleaned.length <= 90) score += 2;
    if (/[—–-].{4,}/.test(cleaned) && MODULE_CODE.test(cleaned)) score += 1;
    /** Module code + term alone (e.g. "MATH 50012 — Spring") is secondary to a real course title line. */
    if (/^[A-Z]{2,6}\s*\d{2,5}\b/.test(cleaned) && cleaned.length < 48 && !/\b(lecture|course|modelling|modeling|analysis|theory|methods)\b/i.test(cleaned)) {
      score -= 4;
    }
    if (/\b(analysis|statistics|probability|calculus|algebra|geometry|series|inference|modelling|modeling)\b/i.test(cleaned)) score += 2;
    if (/^(time\s+series|spatial|stochastic|numerical|bayesian)\b/i.test(cleaned)) score += 2;
    if (/\b(applied|mathematical|advanced|introduction\s+to)\b/i.test(cleaned) && cleaned.length >= 12) score += 1;
    if (page <= 2) score += 1;
    candidates.push({ text: cleaned, page, score });
  }

  candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length);
  const best = candidates[0];
  if (!best) {
    return { title: null, courseName: null, confidence: 0, sourcePage: null };
  }

  const title = best.text.slice(0, 160).trim();
  const confidence = Math.min(0.95, 0.42 + best.score * 0.06);
  return {
    title,
    courseName: title,
    confidence,
    sourcePage: best.page,
  };
}
