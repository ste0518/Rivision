import type { ParsedDocument, RejectedRevisionItem, RejectionCategory, RevisionItem, StandaloneValue } from "@/lib/types";
import { createId } from "@/lib/utils";

type RelevanceDecision = {
  keep: boolean;
  rejectionCategory?: RejectionCategory;
  rejectionReason?: string;
  confidence?: "high" | "medium" | "low";
  standaloneValue: StandaloneValue;
  relevanceReason: string;
};

export type RelevanceSettings = {
  showUnknownLowRelevanceInReview: boolean;
};

const relevanceSettingsKey = "rivision.relevance.settings.v1";
export const defaultRelevanceSettings: RelevanceSettings = { showUnknownLowRelevanceInReview: false };

export function loadRelevanceSettings(): RelevanceSettings {
  if (typeof window === "undefined") return defaultRelevanceSettings;
  const raw = window.localStorage.getItem(relevanceSettingsKey);
  if (!raw) return defaultRelevanceSettings;
  try {
    return { ...defaultRelevanceSettings, ...(JSON.parse(raw) as Partial<RelevanceSettings>) };
  } catch {
    return defaultRelevanceSettings;
  }
}

export function saveRelevanceSettings(settings: RelevanceSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(relevanceSettingsKey, JSON.stringify(settings));
}

export function filterRevisionItemsByRelevance(
  items: RevisionItem[],
  guidanceDocuments: ParsedDocument[],
  settings: RelevanceSettings = defaultRelevanceSettings,
): { keptItems: RevisionItem[]; rejectedItems: RejectedRevisionItem[] } {
  const guidanceText = guidanceDocuments.map((document) => document.fullText).join("\n\n");
  const rejectedItems: RejectedRevisionItem[] = [];
  const scored = items.map((item) => {
    const decision = decideRelevance(item, guidanceText, settings);
    const enriched: RevisionItem = {
      ...item,
      standaloneValue: item.standaloneValue ?? decision.standaloneValue,
      relevanceReason: item.relevanceReason ?? decision.relevanceReason,
      importance: adjustImportance(item, decision, guidanceText),
    };
    return { item: enriched, decision };
  });

  const keptByDecision: RevisionItem[] = [];
  for (const { item, decision } of scored) {
    if (decision.keep) {
      keptByDecision.push(item);
    } else {
      rejectedItems.push(toRejectedItem(item, decision.rejectionCategory ?? "low_value", decision.rejectionReason ?? decision.relevanceReason, decision.confidence ?? "medium"));
    }
  }

  const { keptItems, duplicateRejectedItems } = rejectDuplicates(keptByDecision);
  rejectedItems.push(...duplicateRejectedItems);
  return { keptItems, rejectedItems };
}

function decideRelevance(item: RevisionItem, guidanceText: string, settings: RelevanceSettings): RelevanceDecision {
  const text = `${item.title}\n${item.statement}\n${item.answer}\n${item.originalRawText ?? ""}`;
  const guidance = guidanceText.toLowerCase();
  const lower = text.toLowerCase();

  if (looksLikeBibliography(text)) {
    return reject("bibliography_or_reference", "Looks like bibliography, reading-list, citation, or publisher reference text.", "high", "low");
  }

  if (looksLikeParseNoise(text)) {
    return reject("parse_noise", "Text appears to be parsing noise rather than a usable revision item.", "medium", "low");
  }

  if (item.statement.length > 1800 || wordCount(item.statement) > 220) {
    return reject("too_broad", "Statement is too broad for a standalone flashcard and may contain a whole section.", "medium", "low");
  }

  const explicitlyRequired = isExplicitlyRequired(item, guidance);
  const central = isCentralConcept(item, lower);

  if (item.type === "formula") {
    if (explicitlyRequired || central) {
      return {
        keep: true,
        standaloneValue: explicitlyRequired ? "high" : "medium",
        relevanceReason: explicitlyRequired ? "Formula/topic is referenced by guidance." : "Formula appears to define a central named object.",
      };
    }
    return reject("formula_not_standalone", "Formula does not have a clear named standalone concept or guidance requirement.", "high", "low");
  }

  if (item.type === "remark") {
    if (explicitlyRequired || isConceptuallyImportantRemark(lower)) {
      return {
        keep: true,
        standaloneValue: explicitlyRequired ? "medium" : "medium",
        relevanceReason: explicitlyRequired ? "Remark is referenced by guidance." : "Remark clarifies a central concept, condition, or exam trap.",
      };
    }
    return reject("low_value", "Remark looks explanatory rather than examinable as a standalone card.", "medium", "low");
  }

  if (item.type === "example" && !explicitlyRequired && !central) {
    return reject("ordinary_explanatory_text", "Example is not clearly examinable or central enough for review by default.", "medium", "low");
  }

  if (item.type === "other" && !explicitlyRequired && !central) {
    return reject("ordinary_explanatory_text", "Ordinary explanatory text is not useful as a standalone flashcard.", "medium", "low");
  }

  const standaloneValue: StandaloneValue = item.standaloneValue ?? (explicitlyRequired || item.importance === "must_know" || central ? "high" : "medium");
  if (item.importance === "unknown" && standaloneValue === "low" && !settings.showUnknownLowRelevanceInReview) {
    return reject("not_examinable", "Guidance is unclear and this item has low standalone value.", "medium", "low");
  }

  return {
    keep: true,
    standaloneValue,
    relevanceReason: explicitlyRequired ? "Kept because guidance or section context suggests it is examinable." : "Kept as a labelled item with standalone revision value.",
  };
}

function reject(
  rejectionCategory: RejectionCategory,
  rejectionReason: string,
  confidence: "high" | "medium" | "low",
  standaloneValue: StandaloneValue,
): RelevanceDecision {
  return { keep: false, rejectionCategory, rejectionReason, confidence, standaloneValue, relevanceReason: rejectionReason };
}

function looksLikeBibliography(text: string) {
  const lower = text.toLowerCase();
  let score = 0;
  if (/\[[A-Z]{1,4}\]\s+[A-Z][A-Za-z-]+,/.test(text)) score += 3;
  if (/\b(19|20)\d{2}\b/.test(text)) score += 1;
  if (/\b(CRC Press|Springer|Wiley|John Wiley|Cambridge|Oxford|Chapman|Hall|Routledge|Elsevier)\b/i.test(text)) score += 3;
  if (/\b(bibliography|references|reading list|textbook|publisher|press|edition|isbn|pages?\s+\d+)/i.test(text)) score += 2;
  if (/(?:[A-Z][A-Za-z-]+,\s+[A-Z][A-Za-z-]+(?:,| and)\s*){1,}/.test(text)) score += 2;
  if (/\bTheory of\b|\bStatistics for\b|\bIntroduction to\b|\bSpatial statistics\b/i.test(text)) score += 1;
  if (lower.includes("john wiley & sons")) score += 3;
  return score >= 3;
}

function looksLikeParseNoise(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 20) return true;
  const symbolRatio = (text.match(/[^A-Za-z0-9\s.,;:()[\]{}_^=+\-*/\\]/g)?.length ?? 0) / Math.max(text.length, 1);
  return symbolRatio > 0.3;
}

function isExplicitlyRequired(item: RevisionItem, guidance: string) {
  if (!guidance.trim()) return false;
  const number = item.theoremNumber ?? item.title.match(/\d+(?:\.\d+)*/)?.[0];
  if (number && guidance.includes(number.toLowerCase())) return true;
  const titleWords = normaliseText(item.title).split(" ").filter((word) => word.length > 4);
  const requiredLanguage = /\b(must know|required|examinable|memorise|memorize|learn|derive|prove|state|use)\b/.test(guidance);
  return requiredLanguage && titleWords.some((word) => guidance.includes(word));
}

function isCentralConcept(item: RevisionItem, lower: string) {
  if (/\b(semivariogram|variogram|covariance function|likelihood|blup|kriging predictor|kriging|poisson intensity|conditional distribution|local characteristic|random field|stationary|isotropic|gaussian)\b/.test(lower)) {
    return true;
  }
  if (item.type === "definition" && /\b(is|are|called|defined|denotes)\b/i.test(item.statement)) return true;
  return false;
}

function isConceptuallyImportantRemark(lower: string) {
  return /\b(condition|equivalent|not necessarily|only if|if and only if|trap|important|note that|therefore|generalisation|generalization|distinction|assumption|required|valid)\b/.test(lower) &&
    /\b(random field|process|covariance|stationary|gaussian|kriging|intensity|distribution|theorem|definition|formula)\b/.test(lower);
}

function adjustImportance(item: RevisionItem, decision: RelevanceDecision, guidanceText: string): RevisionItem["importance"] {
  if (!decision.keep) return item.importance;
  const guidance = guidanceText.toLowerCase();
  if (/\bnot required|excluded|do not need|without proof|proofs? are not required\b/.test(guidance) && item.type === "proof") return "not_required";
  if (item.type === "remark" && item.importance === "must_know") return "partial";
  if (item.type === "formula" && decision.standaloneValue === "medium" && item.importance === "must_know") return "partial";
  if (item.importance === "must_know" && !decision.relevanceReason.toLowerCase().includes("guidance") && item.type !== "definition") return "partial";
  return item.importance;
}

function rejectDuplicates(items: RevisionItem[]) {
  const keptItems: RevisionItem[] = [];
  const duplicateRejectedItems: RejectedRevisionItem[] = [];

  for (const item of items) {
    const duplicateIndex = keptItems.findIndex((candidate) => areDuplicates(candidate, item));
    if (duplicateIndex === -1) {
      keptItems.push(item);
      continue;
    }

    const existing = keptItems[duplicateIndex];
    const better = chooseBetterItem(existing, item);
    const rejected = better.id === existing.id ? item : existing;
    keptItems[duplicateIndex] = better;
    duplicateRejectedItems.push(toRejectedItem(rejected, "duplicate", "Duplicate or near-duplicate of a cleaner card.", "high"));
  }

  return { keptItems, duplicateRejectedItems };
}

function areDuplicates(a: RevisionItem, b: RevisionItem) {
  if (a.type === b.type && a.theoremNumber && a.theoremNumber === b.theoremNumber) return true;
  const aTitle = normaliseText(a.title);
  const bTitle = normaliseText(b.title);
  if (aTitle && aTitle === bTitle) return true;
  const aStatement = normaliseText(a.statement);
  const bStatement = normaliseText(b.statement);
  if (!aStatement || !bStatement) return false;
  if (aStatement.includes(bStatement) || bStatement.includes(aStatement)) return true;
  return jaccardSimilarity(aStatement, bStatement) > 0.88;
}

function chooseBetterItem(a: RevisionItem, b: RevisionItem) {
  const score = (item: RevisionItem) =>
    (item.sourceLocation ? 4 : 0) +
    (item.pageNumber ? 3 : 0) +
    (item.statementLatex ? 2 : 0) +
    (item.classificationConfidence === "high" ? 2 : item.classificationConfidence === "medium" ? 1 : 0) +
    (item.guidanceReason ? 1 : 0) -
    (item.statement.length > 1000 ? 2 : 0);
  return score(b) > score(a) ? b : a;
}

function toRejectedItem(
  originalItem: RevisionItem,
  rejectionCategory: RejectionCategory,
  rejectionReason: string,
  confidence: "high" | "medium" | "low",
): RejectedRevisionItem {
  return {
    id: createId("rejected"),
    originalItem: { ...originalItem, standaloneValue: originalItem.standaloneValue ?? "low", relevanceReason: originalItem.relevanceReason ?? rejectionReason },
    rejectionCategory,
    rejectionReason,
    confidence,
  };
}

function normaliseText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function jaccardSimilarity(a: string, b: string) {
  const aWords = new Set(a.split(" ").filter(Boolean));
  const bWords = new Set(b.split(" ").filter(Boolean));
  const intersection = Array.from(aWords).filter((word) => bWords.has(word)).length;
  const union = new Set([...aWords, ...bWords]).size;
  return union === 0 ? 0 : intersection / union;
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}
