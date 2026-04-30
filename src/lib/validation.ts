import type { RevisionItem } from "@/lib/types";
import { countLabelledItems, normaliseRevisionItem, typeFromLabel } from "@/lib/revision-item-utils";

export function validateRevisionItem(item: RevisionItem): string[] {
  const warnings: string[] = [];
  if (!item.title.trim()) warnings.push("Missing title.");
  if (!item.type) warnings.push("Missing type.");
  if (!item.questionPrompt.trim()) warnings.push("Missing question prompt.");
  if (!item.answer.trim()) warnings.push("Missing answer.");
  if (item.importance === "unknown") warnings.push("Importance is unknown.");
  if (!item.sourceLocation?.trim()) warnings.push("Source location is missing.");
  if (item.statement.trim().length > 0 && item.statement.trim().length < 30) warnings.push("Statement is very short and may be incomplete.");
  if (item.type === "definition" && item.statement.length > 1500) warnings.push("Definition is unusually long and may include unrelated text.");
  if (item.title.length > 140) warnings.push("Title is unusually long.");
  if (item.questionPrompt.length > 180) warnings.push("Question prompt is unusually long.");
  if (countLabelledItems(`${item.statement} ${item.proof ?? ""}`) > 1) warnings.push("This card may contain multiple merged items.");
  if (item.extractionWarning) warnings.push(item.extractionWarning);
  const labelledType = typeFromLabel(item.title) ?? typeFromLabel(item.originalRawText ?? "") ?? typeFromLabel(item.statement);
  if (labelledType && labelledType !== item.type) warnings.push(`Type conflicts with labelled source text (${labelledType}).`);
  if (/\b\d+(?:\.\d+)+\s+[A-Z][A-Za-z].{5,80}/.test(item.statement) && countLabelledItems(item.statement) > 0) {
    warnings.push("Statement appears to include unrelated section text.");
  }
  if (item.answer.length > 2500 || countLabelledItems(item.answer) > 1) warnings.push("Answer may repeat an entire section instead of the item.");
  return warnings;
}

export function withValidation(item: RevisionItem): RevisionItem {
  const normalised = normaliseRevisionItem(item);
  return { ...normalised, warnings: validateRevisionItem(normalised) };
}

export function validateAndRepairRevisionItems(items: RevisionItem[]): RevisionItem[] {
  return items.map((item) => {
    const normalised = normaliseRevisionItem(item);
    const statement = normalised.statement;
    const warnings: string[] = [];

    if (countLabelledItems(statement) > 1) warnings.push("Over-merged card: contains multiple labelled items.");
    if (normalised.type === "definition" && statement.length > 800) warnings.push("Definition is unusually long and may include unrelated text.");
    if (normalised.type === "definition" && /\b(Theorem|Proof|Remark|Definition|Lemma|Proposition|Corollary)\b/.test(statement)) {
      warnings.push("Over-merged card: contains multiple labelled items.");
    }
    if (["theorem", "lemma", "proposition", "corollary"].includes(normalised.type) && /\bDefinition\b[\s\S]*\bTheorem\b/.test(statement)) {
      warnings.push("Over-merged card: theorem statement contains earlier definition text.");
    }

    const extractionWarning = normalised.extractionWarning ?? warnings[0];
    return extractionWarning ? { ...normalised, extractionWarning, classificationConfidence: "low" } : normalised;
  });
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
      warning.includes("unrelated section") ||
      warning.includes("entire section"),
    ) ?? [];
    return issues.map((issue) => ({ itemId: item.id, issue }));
  });
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
