/**
 * Source grounding and stale-template detection for local exam-pack extraction.
 * UI / pack vocabulary must not trigger false “contamination” flags.
 */

import { sanitiseExtractedText } from "@/lib/text-layers";

/** App, pack UI, and generic pedagogy labels — never treated as hallucinated technical terms. */
export const APP_SYSTEM_WORD_WHITELIST = new Set(
  [
    "definitions",
    "definition",
    "formulas",
    "formula",
    "derivations",
    "derivation",
    "optionally",
    "optional",
    "conceptual",
    "practice",
    "review",
    "method",
    "template",
    "templates",
    "source",
    "chapter",
    "section",
    "exam",
    "card",
    "quiz",
    "summary",
    "proof",
    "proofs",
    "example",
    "examples",
    "exercise",
    "exercises",
    "topic",
    "topics",
    "item",
    "items",
    "pack",
    "course",
    "notes",
    "lecture",
    "material",
    "recall",
    "worked",
    "candidates",
    "candidate",
    "checklist",
    "packs",
  ].map((w) => w.toLowerCase()),
);

const GENERIC_STOPWORDS = new Set([
  ...APP_SYSTEM_WORD_WHITELIST,
  "theorem",
  "proposition",
  "therefore",
  "following",
  "condition",
  "understanding",
  "introduction",
  "techniques",
  "significant",
  "probability",
  "distribution",
  "expectation",
  "variance",
  "function",
  "random",
  "variable",
  "continuous",
  "lemma",
  "corollary",
  "remark",
  "algorithm",
]);

export function stripUiAndPackLabelsForGrounding(blob: string): string {
  let t = blob;
  for (const w of APP_SYSTEM_WORD_WHITELIST) {
    if (w.length < 4) continue;
    t = t.replace(new RegExp(`\\b${w}\\b`, "gi"), " ");
  }
  return t.replace(/\s+/g, " ").trim();
}

function stripWhitelistPhrases(blob: string): string {
  return stripUiAndPackLabelsForGrounding(blob);
}

/**
 * Long rare tokens in generated text that never occur in the source (stale template / hallucination).
 * Ignores short tokens and UI vocabulary.
 */
export function findProminentTermsAbsentFromSource(generatedTextLower: string, sourceLower: string): string[] {
  const cleaned = stripWhitelistPhrases(generatedTextLower.toLowerCase());
  const hits = cleaned.match(/\b[a-z]{14,}\b/g) ?? [];
  const srcN = normalizeForTechnicalGrounding(sourceLower);
  const out: string[] = [];
  for (const w of hits) {
    if (GENERIC_STOPWORDS.has(w)) continue;
    const wn = normalizeForTechnicalGrounding(w);
    if (!sourceLower.includes(w) && !srcN.includes(wn)) out.push(w);
  }
  return [...new Set(out)].slice(0, 12);
}

/** Heuristic keyword bag for cross-document stale checks (unchanged contract). */
export function buildSourceKeywordSet(sourceLower: string): Set<string> {
  const set = new Set<string>();
  const addPhrase = (s: string) => {
    const t = s.trim().toLowerCase();
    if (t.length >= 4) set.add(t);
  };

  for (const m of sourceLower.matchAll(/\b[a-z][a-z\-]{2,}(?:\s+[a-z][a-z\-]{2,}){0,4}\b/g)) {
    addPhrase(m[0] ?? "");
  }
  for (const m of sourceLower.matchAll(/\b(?:AR|MA|ARMA|ARIMA|SARIMA|ARCH|VAR|ACF|ACVF)\([^)]*\)/gi)) {
    addPhrase(m[0] ?? "");
  }
  return set;
}

/**
 * Flag generated blobs that introduce rare technical tokens absent from source.
 * Skips generic three-word academic prose and UI vocabulary.
 */
export function detectSourceContamination(generatedBlobLower: string, sourceLower: string): string[] {
  const issues: string[] = [];
  const absent = findProminentTermsAbsentFromSource(generatedBlobLower, sourceLower);
  for (const term of absent.slice(0, 10)) {
    issues.push(`Generated text uses “${term}”, which does not appear in the uploaded source — possible stale template or hallucination.`);
  }
  const strippedBlob = stripWhitelistPhrases(generatedBlobLower);
  const phrases = strippedBlob.match(/\b[a-z]{6,}\s+[a-z]{6,}\s+[a-z]{6,}\s+[a-z]{6,}\b/g) ?? [];
  const srcN = normalizeForTechnicalGrounding(sourceLower);
  for (const p of [...new Set(phrases)].slice(0, 8)) {
    if (p.length < 22) continue;
    const pN = normalizeForTechnicalGrounding(p);
    if (!sourceLower.includes(p) && !srcN.includes(pN)) {
      const words = p.split(/\s+/).filter((x) => !APP_SYSTEM_WORD_WHITELIST.has(x));
      if (words.length < 3) continue;
      issues.push(`Generated phrase not grounded in source: “${p.slice(0, 80)}”.`);
    }
  }
  return issues.slice(0, 20);
}

/** True when several long rare tokens appear absent — stricter than per-item gates. */
export function isStaleVersusSource(blobLower: string, sourceLower: string): boolean {
  return findProminentTermsAbsentFromSource(blobLower, sourceLower).length >= 6;
}

/** Fold common abbreviation / spelling variants for technical grounding checks. */
export function normalizeForTechnicalGrounding(text: string): string {
  let t = text.toLowerCase().replace(/\s+/g, " ").trim();
  t = t.replace(/\bself[-\s]?normali[sz]ed\s+importance\s+sampling\b/g, "snis");
  t = t.replace(/\bself[-\s]?normali[sz]ed\b/g, "snis");
  t = t.replace(/\bimportance\s+sampling\b/g, "is");
  t = t.replace(/\bmonte\s+carlo\b/g, "mc");
  t = t.replace(/\bnormali[sz]ed\b/g, "normalised");
  t = t.replace(/\bvariance\b/g, "var");
  t = t.replace(/\bexpectation\b/g, "e");
  t = t.replace(/\bprobability\b/g, "p");
  return t;
}

/** Excerpt from current file must appear in normalised source (substring grounding). */
export function excerptGroundedInSource(excerpt: string, sourceNormalised: string): boolean {
  const ex = sanitiseExtractedText(excerpt)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 400);
  if (ex.length < 10) return false;
  const src = sourceNormalised.toLowerCase();
  const prefix = ex.slice(0, Math.min(120, ex.length));
  if (src.includes(prefix)) return true;
  const exN = normalizeForTechnicalGrounding(excerpt);
  const srcN = normalizeForTechnicalGrounding(sourceNormalised);
  return exN.length >= 10 && srcN.includes(exN.slice(0, Math.min(120, exN.length)));
}
