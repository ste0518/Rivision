/**
 * Low-level text cleanup and printed vs marginalia layer split.
 * Kept separate from document-profile so page-records and profiling can share it without cycles.
 */

const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SOFT_HYPHEN = /\u00ad/g;

export type TextLayers = {
  printedText: string;
  handwrittenText: string;
  noiseText: string;
};

/** Strip control chars and soft hyphens for safe matching and display. */
export function sanitiseExtractedText(raw: string): string {
  return raw.replace(CTRL, "").replace(SOFT_HYPHEN, "");
}

/** Heuristic split: printed lecture body vs marginalia / OCR garbage (line-level). */
export function splitDocumentTextLayers(fullText: string): TextLayers {
  const text = sanitiseExtractedText(fullText.replace(/\r\n/g, "\n"));
  const lines = text.split("\n");
  const printed: string[] = [];
  const handwritten: string[] = [];
  const noise: string[] = [];

  const looksLikeNoiseLine = (line: string): boolean => {
    const t = line.trim();
    if (!t) return false;
    if (t.length <= 2 && /^[A-Za-z0-9]$/.test(t)) return true;
    if (/^[a-z]{1,3}\.{2,}/i.test(t)) return true;
    if (/\bfii+i+n\.?to\b/i.test(t)) return true;
    if (/\bDopulation\b/i.test(t)) return true;
    const alnum = (t.match(/[A-Za-z0-9]/g) ?? []).length;
    const ratio = alnum / Math.max(1, t.length);
    if (t.length < 50 && ratio < 0.35 && /[^\sA-Za-z0-9.,;=+\-()[\]{}]/.test(t)) return true;
    if (t.length < 24 && /^[A-Za-z]\s*$/.test(t)) return true;
    return false;
  };

  /** Conservative: only obvious marginalia / scan artefacts — not normal printed sentences. */
  const looksHandwrittenMarginalia = (line: string): boolean => {
    const t = line.trim();
    if (t.length < 6 || t.length > 140) return false;
    const punctRun = /[!?.]{3,}/.test(t);
    const weirdCaps = (t.match(/[a-z][A-Z]/g) ?? []).length >= 3;
    const digitLetterChaos = (t.match(/\d/g) ?? []).length >= 4 && (t.match(/[A-Za-z]/g) ?? []).length >= 4 && /\d[A-Za-z]\d/.test(t);
    const noSpacesLongToken = /\S{36,}/.test(t);
    return weirdCaps || punctRun || (digitLetterChaos && t.length < 90) || noSpacesLongToken;
  };

  for (const line of lines) {
    const t = line.trimEnd();
    if (!t.trim()) {
      printed.push("");
      continue;
    }
    if (looksLikeNoiseLine(t)) {
      noise.push(t);
      continue;
    }
    if (looksHandwrittenMarginalia(t)) {
      handwritten.push(t);
      continue;
    }
    printed.push(line);
  }

  return {
    printedText: printed.join("\n"),
    handwrittenText: handwritten.join("\n"),
    noiseText: noise.join("\n"),
  };
}
