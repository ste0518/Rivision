import type { ParsedDocument, StudyFileRole } from "@/lib/types";

export type PageRecord = {
  pageNumber: number;
  text: string;
  sourceFile: string;
  role: StudyFileRole;
  headings: string[];
  charCount: number;
};

const headingPattern = /^(?:chapter|section|lecture|topic|\d+(?:\.\d+)*|[A-Z][A-Z\s]{5,})\b[:.)\-\s]*(.+)?$/i;

export function pageRecordsFromDocument(document: ParsedDocument): PageRecord[] {
  const role = document.role ?? "other";
  if (document.pages?.length) {
    return document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      text: page.text,
      sourceFile: document.sourceFile,
      role,
      headings: extractHeadings(page.text),
      charCount: page.charCount,
    }));
  }

  const pages = splitRenderedPages(document.fullText);
  if (pages.length) {
    return pages.map((page, index) => ({
      pageNumber: page.pageNumber ?? index + 1,
      text: page.text,
      sourceFile: document.sourceFile,
      role,
      headings: extractHeadings(page.text),
      charCount: page.text.length,
    }));
  }

  return [{
    pageNumber: 1,
    text: document.fullText,
    sourceFile: document.sourceFile,
    role,
    headings: extractHeadings(document.fullText),
    charCount: document.fullText.length,
  }];
}

export function extractHeadings(text: string) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 4 && line.length <= 120)
    .filter((line) => headingPattern.test(line) || /^#+\s+/.test(line))
    .slice(0, 8);
}

function splitRenderedPages(fullText: string) {
  const parts = fullText.split(/\n-{3,}\nPage\s+(\d+)[^\n]*\n-{3,}\n/g);
  if (parts.length <= 1) return [];
  const pages: Array<{ pageNumber?: number; text: string }> = [];
  for (let index = 1; index < parts.length; index += 2) {
    const pageNumber = Number(parts[index]);
    const text = parts[index + 1]?.trim() ?? "";
    if (text) pages.push({ pageNumber: Number.isFinite(pageNumber) ? pageNumber : undefined, text });
  }
  return pages;
}

