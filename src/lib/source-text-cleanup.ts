/**
 * Normalises uploaded lecture text before study-pack extraction and LLM pipelines.
 * Preserves `[Page N]` markers and paragraph structure (newlines).
 */

const GLUED_WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bselfnormalised\b/gi, "self-normalised"],
  [/\bselfnormalized\b/gi, "self-normalized"],
  [/\bwelldefined\b/gi, "well-defined"],
  [/\bacceptreject\b/gi, "accept-reject"],
  [/\blogdomain\b/gi, "log-domain"],
  [/\blogtrick\b/gi, "log-trick"],
  [/\bstatespace\b/gi, "state-space"],
  [/\bsamplingbased\b/gi, "sampling-based"],
  [/\bpriorlikelihood\b/gi, "prior-likelihood"],
];

/** Strips typical end-of-document bibliography blocks (does not remove inline citations). */
export function stripBibliographySection(text: string): string {
  const t = text.replace(/\r\n/g, "\n");
  const markers = [
    /(?:^|\n)\s*BIBLIOGRAPHY\s*(?:\n|$)/i,
    /(?:^|\n)\s*Bibliography\s*(?:\n|$)/i,
    /(?:^|\n)\s*References\s*(?:\n|$)/i,
    /(?:^|\n)\s*REFERENCES\s*(?:\n|$)/i,
  ];
  let cut = t.length;
  for (const re of markers) {
    const m = re.exec(t);
    if (m && m.index !== undefined && m.index >= 80) {
      cut = Math.min(cut, m.index);
    }
  }
  return cut < t.length ? t.slice(0, cut).trimEnd() : t;
}

export function normalizeGluedWords(text: string): string {
  let out = text;
  for (const [re, rep] of GLUED_WORD_REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out;
}

/** Removes C0/C1 control characters except newline (LF) and tab. */
export function stripControlCharactersExceptNewlineTab(text: string): string {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/**
 * Full cleanup for parsed notes prior to segmentation / study-pack generation.
 */
export function cleanUploadedStudySourceText(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  t = stripControlCharactersExceptNewlineTab(t);
  t = stripBibliographySection(t);
  t = normalizeGluedWords(t);
  return t;
}
