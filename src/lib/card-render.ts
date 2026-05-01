import type { RevisionItem } from "@/lib/types";
import { normalizeMathNotation, isGenericConceptName, validateLatexQuality } from "@/lib/revision-item-utils";

export function getPrimaryCardPreview(item: RevisionItem) {
  if (item.statementLatex?.trim()) return item.statementLatex;
  if (item.answerLatex?.trim()) return item.answerLatex;
  if (item.statement?.trim()) return normalizeMathNotation(item.statement);
  return item.statement;
}

export function hasLowLatexQuality(item: RevisionItem) {
  return validateLatexQuality(item).score === "low";
}

export function hasGenericConceptName(item: RevisionItem) {
  return isGenericConceptName(item.conceptName || item.cardFront);
}
