import type { GeneratedDefinitionItem, GeneratedFormulaItem, GeneratedMethodTemplate, GeneratedProofItem } from "@/lib/student-revision-schema";
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

function sourceLocationForPack(d: { source?: string; sourceFile?: string; formalLabel?: string; sourceSection?: string; sourcePage?: number; sourceLabel?: string }) {
  const parts = [d.formalLabel ?? d.sourceLabel, d.sourceSection, d.sourcePage != null ? `p. ${d.sourcePage}` : undefined].filter(Boolean);
  return parts.length ? parts.join(" · ") : d.sourceFile ?? d.source ?? "study pack";
}

export function cardFromDefinition(d: GeneratedDefinitionItem): RevisionItem {
  const type =
    d.itemKind === "theorem" || d.itemKind === "proposition" || d.itemKind === "lemma" || d.itemKind === "corollary"
      ? d.itemKind
      : "definition";
  return baseItem({
    type,
    title: d.formalLabel ? `${d.formalLabel}: ${d.term}` : d.term,
    conceptName: d.term,
    displayTitle: d.formalLabel ? `${d.formalLabel} (${d.term})` : d.term,
    cardFront: d.term,
    taskPrompt: "Recall the definition.",
    statement: d.definition,
    sourceFile: d.sourceFile ?? d.source,
    sourceLocation: sourceLocationForPack(d),
    pageNumber: d.sourcePage,
    section: d.sourceSection,
    tags: ["study_pack", "definition", ...(d.itemKind ? [d.itemKind] : [])],
    importance: d.importance === "must_know" ? "must_know" : d.importance === "high" ? "partial" : "partial",
    cardPurpose: type === "definition" ? "definition_recall" : "theorem_statement",
    questionPrompt: `What is ${d.term}?`,
    answer: d.definition,
    revisionPackCategory: "mustKnowDefinitions",
    priorityLabel: d.importance === "must_know" ? "very_high" : "high",
    theoremNumber: d.formalLabel?.match(/\d+(?:\.\d+)*/)?.[0],
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
    sourceFile: f.sourceFile ?? f.source,
    sourceLocation: [f.sourceLabel, f.sourceSection, f.sourcePage != null ? `p. ${f.sourcePage}` : undefined].filter(Boolean).join(" · ") || f.source,
    pageNumber: f.sourcePage,
    section: f.sourceSection,
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

export function cardFromMethod(m: GeneratedMethodTemplate): RevisionItem {
  const steps = m.steps.join("\n\n");
  return baseItem({
    type: "algorithm",
    title: m.problemType,
    conceptName: m.problemType,
    displayTitle: m.problemType,
    cardFront: m.problemType,
    taskPrompt: m.relatedPracticeType,
    statement: steps,
    sourceFile: "study pack",
    sourceLocation: m.problemType,
    tags: ["study_pack", "method", ...m.triggerWords.slice(0, 6)],
    importance: "must_know",
    cardPurpose: "method_steps",
    questionPrompt: `Outline the procedure: ${m.problemType}`,
    answer: steps,
    revisionPackCategory: "methodsAndTemplates",
    priorityLabel: "high",
  });
}

export function cardFromProof(p: GeneratedProofItem): RevisionItem {
  const loc =
    [p.sourceLabel, p.sourceSection, p.sourcePage != null ? `p. ${p.sourcePage}` : undefined].filter(Boolean).join(" · ") ||
    p.sourceFile ||
    p.source ||
    "study pack";
  return baseItem({
    type: "proof",
    title: p.proofName ?? p.name,
    conceptName: p.proofName ?? p.name,
    displayTitle: p.proofName ?? p.name,
    cardFront: p.proofName ?? p.name,
    taskPrompt: "Outline the proof.",
    statement: p.statement,
    proof: p.proofSkeleton,
    sourceFile: p.sourceFile ?? p.source ?? "study pack",
    sourceLocation: loc,
    pageNumber: p.sourcePage,
    section: p.sourceSection,
    tags: ["study_pack", "proof"],
    importance: "must_know",
    cardPurpose: "proof_recall",
    questionPrompt: `Prove or explain: ${p.proofName ?? p.name}`,
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
