import type { RevisionItem } from "@/lib/types";
import { countLabelledItems, normaliseRevisionItem, typeFromLabel } from "@/lib/revision-item-utils";

export type RevisionItemsValidationResult = {
  validItems: RevisionItem[];
  invalidItems: RevisionItem[];
  warnings: string[];
};

export function validateRevisionItem(item: RevisionItem): string[] {
  const warnings: string[] = [];
  if (!item.title.trim()) warnings.push("Missing title.");
  if (!item.type) warnings.push("Missing type.");
  if (!item.questionPrompt.trim()) warnings.push("Missing question prompt.");
  if (!item.answer.trim()) warnings.push("Missing answer.");
  if (item.importance === "unknown") warnings.push("Importance is unknown.");
  if (!item.sourceLocation?.trim()) warnings.push("Source location is missing.");
  if (item.statement.trim().length > 0 && item.statement.trim().length < 30) warnings.push("Statement is very short and may be incomplete.");
  if (item.type === "definition" && startsSuspiciously(item.statement)) warnings.push("Definition statement starts suspiciously and may be missing its beginning.");
  if (item.type === "definition" && item.statement.length > 800) warnings.push("Definition is unusually long and may include unrelated text.");
  if (item.title.length > 120) warnings.push("Title is unusually long.");
  if (item.questionPrompt.length > 180) warnings.push("Question prompt is unusually long.");
  if (countLabelledItems(item.statement) > 1) warnings.push("This card may contain multiple merged items.");
  if (item.extractionWarning) warnings.push(item.extractionWarning);
  const labelledType = typeFromLabel(item.title) ?? typeFromLabel(item.originalRawText ?? "") ?? typeFromLabel(item.statement);
  if (labelledType && labelledType !== item.type) warnings.push(`Type conflicts with labelled source text (${labelledType}).`);
  if (containsSubsectionHeadingAfterItem(item.statement)) {
    warnings.push("Statement appears to include unrelated section text.");
  }
  if (item.answer.length > 2500 || countLabelledItems(item.answer) > 1) warnings.push("Answer may repeat an entire section instead of the item.");
  return warnings;
}

export function withValidation(item: RevisionItem): RevisionItem {
  const normalised = normaliseRevisionItem(item);
  return { ...normalised, warnings: validateRevisionItem(normalised) };
}

export function validateAndRepairRevisionItems(items: RevisionItem[]): RevisionItemsValidationResult {
  const validItems: RevisionItem[] = [];
  const invalidItems: RevisionItem[] = [];
  const warnings: string[] = [];

  for (const item of items) {
    const normalised = normaliseRevisionItem(item);
    const itemWarnings = collectHardValidationWarnings(normalised);
    const repaired = itemWarnings.length
      ? {
        ...normalised,
        extractionWarning: normalised.extractionWarning ?? itemWarnings[0],
        warnings: [...(normalised.warnings ?? []), ...itemWarnings],
        classificationConfidence: "low" as const,
      }
      : normalised;

    if (itemWarnings.length > 0) {
      invalidItems.push(repaired);
      warnings.push(...itemWarnings.map((warning) => `${normalised.title}: ${warning}`));
    } else {
      validItems.push(repaired);
    }
  }

  return { validItems, invalidItems, warnings };
}

export function buildSuspiciousItems(items: RevisionItem[]) {
  return items.flatMap((item) => {
    const issues = item.warnings?.filter((warning) =>
      warning.includes("multiple merged") ||
      warning.includes("Over-merged") ||
      warning.includes("unusually long") ||
      warning.includes("Source location is missing") ||
      warning.includes("Type conflicts") ||
      warning.includes("Question prompt") ||
      warning.includes("missing its beginning") ||
      warning.includes("unrelated section") ||
      warning.includes("entire section"),
    ) ?? [];
    return issues.map((issue) => ({ itemId: item.id, issue }));
  });
}

function collectHardValidationWarnings(item: RevisionItem): string[] {
  const warnings: string[] = [];
  const statement = item.statement;

  if (countLabelledItems(statement) > 1) warnings.push("Over-merged card: statement contains multiple major labels.");
  if (item.type === "definition" && /\b(Theorem|Proof|Remark|Definition|Lemma|Proposition|Corollary)\b/.test(statement)) {
    warnings.push("Over-merged card: definition statement contains another major label.");
  }
  if (["theorem", "lemma", "proposition", "corollary"].includes(item.type) && /\bDefinition\b[\s\S]*\bTheorem\b/.test(statement)) {
    warnings.push("Over-merged card: theorem statement contains a preceding definition.");
  }
  if (item.type === "definition" && statement.length > 800) warnings.push("Definition is unusually long and may include unrelated text.");
  if (item.type === "definition" && startsSuspiciously(statement)) warnings.push("Definition statement starts suspiciously and may be missing its beginning.");
  if (item.questionPrompt.length > 180) warnings.push("Question prompt is unusually long.");
  if (item.title.length > 120) warnings.push("Title is unusually long.");
  if (!item.sourceLocation?.trim()) warnings.push("Source location is missing.");
  if (containsSubsectionHeadingAfterItem(statement)) warnings.push("Statement appears to include unrelated section text.");
  if (item.extractionWarning?.includes("Over-merged") || item.extractionWarning?.includes("multiple major label")) {
    warnings.push(item.extractionWarning);
  }

  return Array.from(new Set(warnings));
}

function containsSubsectionHeadingAfterItem(statement: string) {
  return /(?:^|\s)(?:Chapter|Section)\s+\d+(?:\.\d+)*\b/i.test(statement) ||
    /(?:^|\s)\d+(?:\.\d+)*\s+[A-Z][A-Za-z][A-Za-z\s,&-]{5,90}(?:\n|$)/.test(statement);
}

function startsSuspiciously(statement: string) {
  return /^(?:[,.;:)]|\]|\.\.\.|…|Xn\)|X_n\)|,\s*Xn\)|,\s*X_n\))/i.test(statement.trim());
}

export function validateRevisionItemsPayload(payload: unknown): { items: RevisionItem[]; errors: string[] } {
  if (!Array.isArray(payload)) return { items: [], errors: ["JSON must be an array of RevisionItem objects."] };

  const errors: string[] = [];
  const items: RevisionItem[] = [];

  payload.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== "object") {
      errors.push(`Item ${index + 1}: must be an object.`);
      return;
    }

    const item = candidate as Partial<RevisionItem>;
    const missing: string[] = [];
    if (!item.id) missing.push("id");
    if (!item.type) missing.push("type");
    if (!item.title) missing.push("title");
    if (!item.statement) missing.push("statement");
    if (!item.sourceFile) missing.push("sourceFile");
    if (!Array.isArray(item.tags)) missing.push("tags");
    if (!item.importance) missing.push("importance");
    if (!item.questionPrompt) missing.push("questionPrompt");
    if (!item.answer) missing.push("answer");
    if (!item.createdAt) missing.push("createdAt");
    if (!item.updatedAt) missing.push("updatedAt");

    if (missing.length > 0) {
      errors.push(`Item ${index + 1}: missing required field(s): ${missing.join(", ")}`);
      return;
    }

    items.push(item as RevisionItem);
  });

  return { items, errors };
}
