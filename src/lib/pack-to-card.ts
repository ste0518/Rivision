import type { GeneratedDefinitionItem, GeneratedFormulaItem, GeneratedProofItem } from "@/lib/student-revision-schema";
import type { RevisionItem } from "@/lib/types";
import { withValidation } from "@/lib/validation";
import { createId } from "@/lib/utils";

const now = () => new Date().toISOString();

function baseItem(partial: Omit<RevisionItem, "id" | "createdAt" | "updatedAt" | "priorityScore" | "priorityLabel" | "evidenceSignals" | "whyThisCardMatters"> & Partial<Pick<RevisionItem, "priorityScore" | "priorityLabel">>): RevisionItem {
  const ts = now();
  const item: RevisionItem = {
    id: createId("card"),
    createdAt: ts,
    updatedAt: ts,
    priorityScore: partial.priorityScore ?? 70,
    priorityLabel: partial.priorityLabel ?? "high",
    evidenceSignals: [],
    whyThisCardMatters: "Created from your study pack for active recall.",
    ...partial,
  };
  return withValidation(item);
}

export function cardFromDefinition(d: GeneratedDefinitionItem): RevisionItem {
  return baseItem({
    type: "definition",
    title: d.term,
    conceptName: d.term,
    displayTitle: d.term,
    cardFront: d.term,
    taskPrompt: "Recall the definition.",
    statement: d.definition,
    sourceFile: d.source,
    sourceLocation: d.source,
    tags: ["study_pack", "definition"],
    importance: d.importance === "must_know" ? "must_know" : "partial",
    cardPurpose: "definition_recall",
    questionPrompt: `What is ${d.term}?`,
    answer: d.definition,
    revisionPackCategory: "mustKnowDefinitions",
    priorityLabel: d.importance === "must_know" ? "very_high" : "high",
  });
}

export function cardFromFormula(f: GeneratedFormulaItem): RevisionItem {
  return baseItem({
    type: "formula",
    title: f.name,
    conceptName: f.name,
    displayTitle: f.name,
    cardFront: f.name,
    taskPrompt: f.whenToUse,
    statement: f.latex,
    sourceFile: f.source,
    sourceLocation: f.source,
    tags: ["study_pack", "formula"],
    importance: "must_know",
    cardPurpose: "formula_recall",
    questionPrompt: `State or derive: ${f.name}`,
    answer: f.latex,
    answerLatex: f.latex,
    latexQuality: f.mathStatus === "ok" ? "high" : "medium",
    revisionPackCategory: "formulasToKnow",
  });
}

export function cardFromProof(p: GeneratedProofItem): RevisionItem {
  return baseItem({
    type: "proof",
    title: p.name,
    conceptName: p.name,
    displayTitle: p.name,
    cardFront: p.name,
    taskPrompt: "Outline the proof.",
    statement: p.statement,
    proof: p.proofSkeleton,
    sourceFile: p.source ?? "study pack",
    sourceLocation: p.source,
    tags: ["study_pack", "proof"],
    importance: "must_know",
    cardPurpose: "proof_recall",
    questionPrompt: `Prove or explain: ${p.name}`,
    answer: `${p.proofSkeleton}\n\nCommon mistake: ${p.commonMistake}`,
    revisionPackCategory: "proofsToKnow",
  });
}

export function mockExplainNote(topic: string): string {
  return `Local outline for “${topic}”: define terms, give one short intuition, then connect to how past papers tend to ask about it. Replace this with your lecturer’s wording after checking notes.`;
}

export function mockPracticeFromTopic(topic: string): string {
  return `Timed drill: write a 5-mark exam-style answer that uses ${topic}. Self-mark against definitions in your pack.`;
}
