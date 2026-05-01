import { hasGenericConceptName } from "@/lib/card-render";
import { validateLatexQuality } from "@/lib/revision-item-utils";
import type { RevisionItem } from "@/lib/types";

const MAX_ANSWER_CHARS = 1800;

/** Reasons a kept card cannot enter normal review until fixed. */
export function collectReviewQualityGateReasons(item: RevisionItem): string[] {
  const reasons: string[] = [];
  const decision = item.curationDecision ?? "keep";
  if (decision !== "keep") return reasons;

  const answerLen = Math.max((item.answer ?? "").length, (item.answerLatex ?? "").length);
  if (answerLen > MAX_ANSWER_CHARS) reasons.push(`Answer exceeds ${MAX_ANSWER_CHARS} characters (${answerLen}).`);

  if (hasGenericConceptName(item)) reasons.push("Card front is too generic for review.");

  const latex = validateLatexQuality(item);
  if (latex.score === "low") reasons.push("LaTeX quality is low; fix math before review.");

  const tags = new Set((item.tags ?? []).map((t) => t.toLowerCase()));
  if (tags.has("verification-missing") || tags.has("debug")) reasons.push("Marked as debug or verification placeholder.");

  const blob = `${item.statement ?? ""}\n${item.cardFront ?? ""}`;
  if (/\boffsets?\s+\d+\s*[-–]\s*\d+/i.test(blob)) reasons.push("Looks like raw candidate offset metadata.");

  if (/\[PDF placeholder\]|placeholder\]/i.test(`${item.statement}\n${item.answer}`)) reasons.push("Contains placeholder or incomplete extraction text.");

  if (item.cardPurpose === "background_context" && (item.statement?.length ?? 0) > 900) {
    reasons.push("Long background / transition paragraph; needs splitting or curation.");
  }

  if ((item.tags ?? []).some((t) => t.includes("extraction-debug"))) reasons.push("Raw debug extraction tag.");

  return reasons;
}

export function demoteItemForQualityGates(item: RevisionItem): RevisionItem {
  if ((item.curationDecision ?? "keep") !== "keep") return item;
  const reasons = collectReviewQualityGateReasons(item);
  if (reasons.length === 0) return item;
  const note = reasons.join(" ");
  return {
    ...item,
    curationDecision: "needs_review",
    curationStatus: "needs_review",
    revisionPackCategory: "needsReview",
    cardPurpose: "needs_review",
    curationReason: [item.curationReason, `Quality gate: ${note}`].filter(Boolean).join(" · "),
    uncertaintyNote: [item.uncertaintyNote, note].filter(Boolean).join(" · "),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Moves failing "kept" items into needs-review; preserves items already needs_review/reject.
 */
export function applyReviewQualityGatesSplit(
  keptPipelineItems: RevisionItem[],
  existingNeedsReview: RevisionItem[],
): { kept: RevisionItem[]; needsReview: RevisionItem[] } {
  const needsReview = [...existingNeedsReview];
  const kept: RevisionItem[] = [];
  for (const item of keptPipelineItems) {
    const demoted = demoteItemForQualityGates(item);
    if ((demoted.curationDecision ?? "keep") === "needs_review") needsReview.push(demoted);
    else kept.push(demoted);
  }
  return { kept, needsReview };
}
