import type { RevisionItem } from "@/lib/types";

export function validateRevisionItem(item: RevisionItem): string[] {
  const warnings: string[] = [];
  if (!item.title.trim()) warnings.push("Missing title.");
  if (!item.type) warnings.push("Missing type.");
  if (!item.questionPrompt.trim()) warnings.push("Missing question prompt.");
  if (!item.answer.trim()) warnings.push("Missing answer.");
  if (item.importance === "unknown") warnings.push("Importance is unknown.");
  if (!item.sourceLocation?.trim()) warnings.push("Source location is missing.");
  if (item.statement.trim().length > 0 && item.statement.trim().length < 30) warnings.push("Statement is very short and may be incomplete.");
  return warnings;
}

export function withValidation(item: RevisionItem): RevisionItem { return { ...item, warnings: validateRevisionItem(item) }; }

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
