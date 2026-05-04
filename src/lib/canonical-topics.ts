/**
 * Topic strings for document profiles — noun-like concepts, not filler bigrams.
 */

export type CanonicalTopicEntry = {
  label: string;
  sourcePages: number[];
  confidence: number;
};

const STOP_PHRASES = new Set([
  "the same",
  "called the",
  "all the",
  "for all",
  "that the",
  "the form",
  "for any",
  "and hence",
  "has the",
  "can write",
  "we have",
  "it follows",
  "note that",
  "given that",
  "such that",
  "suppose that",
  "assume that",
  "this estimator",
  "that minimises",
  "that minimizes",
  "sampling from",
  "this integral",
  "lecture notes",
  "this section",
  "samples from",
  "other words",
  "recall that",
  "have access",
  "sample from",
  "would like",
  "true value",
  "this means",
  "this case",
  "have seen",
  "seen from",
  "show that",
]);

const ADMIN_PHRASE = /\b(blackboard|assessment|department|room\s+[a-z]?\d|@\w+\.\w+|use\s+blackboard|course\s+materials|postal|address)\b/i;

const BIGRAM_STOP = new Set([
  "for the",
  "and the",
  "of the",
  "in the",
  "to the",
  "on the",
  "at the",
  "by the",
  "from the",
  "with the",
]);

function normalisePhrase(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function isGarbageTopic(t: string): boolean {
  const n = normalisePhrase(t);
  if (n.length < 5 || n.length > 72) return true;
  if (STOP_PHRASES.has(n)) return true;
  if (/\b(this|that|other)\s+\w+\s+(estimator|integral|section|case|value)\b/.test(n)) return true;
  if (ADMIN_PHRASE.test(n)) return true;
  if (/\b(the|a|an)\s+(the|same|form|following)\b/.test(n)) return true;
  if ((n.match(/\s+/g) ?? []).length >= 5 && !/[=∫∑^_]/.test(n)) return true;
  const words = n.split(/\s+/);
  if (words.length > 5 && !/[=∫∑]/.test(n)) return true;
  return false;
}

/**
 * Build deduplicated canonical topic labels (1–5 words) from headings and frequent meaningful bigrams.
 */
export function canonicalTopicsFromDocument(
  combinedPrinted: string,
  headingTitles: string[],
  extraHeadingLines: string[],
): string[] {
  const topics = new Map<string, number>();

  const bump = (raw: string, w = 1) => {
    let t = raw.replace(/\s+/g, " ").replace(/^[\d.)\s]+/g, "").trim();
    if (t.length < 4 || t.length > 70) return;
    const words = t.split(/\s+/).filter((x) => x.length > 1);
    if (words.length > 5) t = words.slice(0, 5).join(" ");
    const n = normalisePhrase(t);
    if (isGarbageTopic(n)) return;
    topics.set(n, (topics.get(n) ?? 0) + w);
  };

  for (const h of [...headingTitles, ...extraHeadingLines]) {
    bump(h, 2);
  }

  const slice = combinedPrinted.slice(0, 220_000).toLowerCase();
  const bigramRe = /\b([a-z][a-z-]{3,})\s+([a-z][a-z-]{3,})\b/g;
  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = bigramRe.exec(slice)) !== null) {
    const a = m[1]!;
    const b = m[2]!;
    const key = `${a} ${b}`;
    if (BIGRAM_STOP.has(key)) continue;
    if (STOP_PHRASES.has(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [k, c] of counts.entries()) {
    if (c >= 5) bump(k, 1);
  }

  return [...topics.entries()]
    .sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)
    .map(([k]) => k)
    .slice(0, 80);
}

/**
 * Topics with page hints (from page-aware headings) and confidence for QA / debug.
 */
export function canonicalTopicEntriesFromDocument(
  combinedPrinted: string,
  headingSignals: Array<{ text: string; pageNumber?: number; weight?: number }>,
): CanonicalTopicEntry[] {
  const uniqueTexts = [...new Set(headingSignals.map((h) => h.text.trim()).filter((t) => t.length > 2))];
  const labels = canonicalTopicsFromDocument(combinedPrinted, uniqueTexts, []);

  const out: CanonicalTopicEntry[] = [];
  for (const label of labels) {
    const pages = new Set<number>();
    for (const h of headingSignals) {
      const n = normalisePhrase(h.text.replace(/^[\d.)\s]+/g, "").trim());
      if (n.length < 4) continue;
      if (n.includes(label) || label.includes(n.slice(0, Math.min(24, n.length)))) pages.add(h.pageNumber ?? 1);
    }
    const pageArr = [...pages].sort((a, b) => a - b);
    const w = headingSignals.filter((h) => normalisePhrase(h.text).includes(label.slice(0, Math.min(16, label.length))));
    const confidence = Math.min(0.95, 0.42 + 0.07 * Math.min(5, w.length) + (pageArr.length > 1 ? 0.06 : 0));
    out.push({
      label,
      sourcePages: pageArr,
      confidence: pageArr.length ? confidence : Math.min(confidence, 0.36),
    });
  }
  return dedupeTopicEntries(out).slice(0, 80);
}

function dedupeTopicEntries(items: CanonicalTopicEntry[]): CanonicalTopicEntry[] {
  const seen = new Set<string>();
  const out: CanonicalTopicEntry[] = [];
  for (const x of items) {
    const k = x.label.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
  }
  return out;
}
