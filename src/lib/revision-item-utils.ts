import { createId } from "@/lib/utils";
import { inferTopic, splitShortLeadingTitle, stripLeadingLabel } from "@/lib/segmentation";
import type { RevisionItem, RevisionItemType } from "@/lib/types";

const labelledItemRegex = /\b(Definition|Theorem|Lemma|Proposition|Corollary|Proof|Remark|Example|Assumption|Property|Algorithm|Formula)\s*(?:[A-Za-z]?\d+(?:\.\d+)*)?\b/g;
const proofMarkerRegex = /\bProof(?:\s+of\s+(?:Theorem|Lemma|Proposition|Corollary)\s*[A-Za-z]?\d*(?:\.\d+)*)?\s*[:.]/i;

export function normaliseRevisionItem(item: RevisionItem): RevisionItem {
  const now = new Date().toISOString();
  const originalRawText = item.originalRawText ?? item.statement;
  const correctedType = typeFromLabel(item.title) ?? typeFromLabel(item.originalRawText ?? "") ?? typeFromLabel(item.statement) ?? item.type;
  const split = splitProofFromStatement(item.statement);
  const statementParts = splitShortLeadingTitle(split.statement);
  const statement = clean(statementParts.statement);
  const proof = clean(item.proof ?? split.proof ?? "");
  const theoremNumber = item.theoremNumber ?? extractNumber(item.title) ?? extractNumber(item.originalRawText ?? "") ?? extractNumber(item.sourceLocation ?? "");
  const title = normaliseTitle({ ...item, type: correctedType, theoremNumber, statement, titleTopic: statementParts.title });
  const extractionWarning = item.extractionWarning ?? buildExtractionWarning({ ...item, type: correctedType, title, statement, proof });
  const proofRequired = theoremLike(correctedType) ? item.proofRequired : undefined;
  const answer = cleanAnswer(correctedType, statement, item.answer);
  const statementLatex = item.statementLatex ?? convertCommonMathToLatex(statement);
  const proofLatex = proof ? item.proofLatex ?? convertCommonMathToLatex(proof) : undefined;
  const answerLatex = item.answerLatex ?? convertCommonMathToLatex(answer);

  return {
    ...item,
    id: item.id || createId("card"),
    type: correctedType,
    title,
    statement,
    statementLatex,
    originalRawText,
    proof: proof || undefined,
    proofLatex,
    proofRequired,
    theoremNumber,
    extractionWarning,
    questionPrompt: buildQuestionPrompt({ ...item, type: correctedType, title, theoremNumber, statement, proofRequired }),
    answer,
    answerLatex,
    classificationConfidence: item.classificationConfidence ?? (extractionWarning ? "low" : "medium"),
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now,
  };
}

export function splitProofFromStatement(statement: string) {
  const match = statement.match(proofMarkerRegex);
  if (!match || match.index === undefined) return { statement: clean(statement), proof: undefined };
  const before = statement.slice(0, match.index);
  const after = statement.slice(match.index + match[0].length);
  return { statement: clean(before), proof: trimProofAtBoundary(clean(after)) };
}

export function buildQuestionPrompt(item: Pick<RevisionItem, "type" | "title" | "theoremNumber" | "statement"> & { proofRequired?: boolean }) {
  const number = item.theoremNumber ?? extractNumber(item.title);
  const numberedLabel = number ? `${capitalise(item.type)} ${number}` : item.title.replace(/[.:]\s*$/, "");
  const topic = topicFromItem(item);

  if (item.type === "definition") {
    return number ? `State Definition ${number}: ${topic || "the concept"}.` : `State the definition of ${topic || cleanTitle(item.title)}.`;
  }

  if (theoremLike(item.type)) {
    if (item.proofRequired) return `Prove ${numberedLabel}.`;
    if (item.proofRequired === false) return `State ${numberedLabel}. The proof is not required.`;
    return `State ${numberedLabel} and explain its conditions.`;
  }

  if (item.type === "formula") {
    return `Write down the formula for ${topic || cleanTitle(item.title)} and explain each term.`;
  }

  if (item.type === "remark" || item.type === "example") {
    return `Explain the ${item.type} about ${topic || cleanTitle(item.title)}.`;
  }

  if (item.type === "proof") return `Prove ${topic || cleanTitle(item.title)}.`;
  return `Explain ${cleanTitle(item.title)}.`;
}

export function convertCommonMathToLatex(value: string) {
  let text = value;

  text = replaceOutsideInlineMath(
    text,
    /\bX\s*=\s*\(\s*X\s*_?\s*t\s*\)\s*(?:_\{\s*t\s*(?:in|∈)\s*T\s*\}|\s*t\s*∈\s*T)/gi,
    () => "\\(X=(X_t)_{t\\in T}\\)",
    false,
  );
  text = replaceOutsideInlineMath(text, /\bX_t\b/g, () => "\\(X_t\\)", false);
  text = replaceOutsideInlineMath(text, /\bt\s+in\s+T\b/g, () => "\\(t\\in T\\)", false);
  text = replaceOutsideInlineMath(text, /\bt\s*∈\s*T\b/g, () => "\\(t\\in T\\)", false);
  text = replaceOutsideInlineMath(text, /\bR\^([A-Za-z0-9]+)\b/g, (_match, power) => `\\mathbb{R}^${power}`);
  text = replaceOutsideInlineMath(text, /\bR\s+d\b/g, () => "\\mathbb{R}^d");
  text = replaceOutsideInlineMath(text, /\bsigma\^2\b/gi, () => "\\sigma^2");
  text = replaceOutsideInlineMath(text, /\bsigma\b/gi, () => "\\sigma");
  text = replaceOutsideInlineMath(text, /\bmu\b/gi, () => "\\mu");
  text = replaceOutsideInlineMath(text, /\bSigma\b/g, () => "\\Sigma");
  text = replaceOutsideInlineMath(text, /\bCov\b/g, () => "\\operatorname{Cov}");
  text = replaceOutsideInlineMath(text, /\bgamma\b/gi, () => "\\gamma");

  return text;
}

function isInsideInlineMath(source: string, offset: number) {
  const open = source.lastIndexOf("\\(", offset);
  const close = source.lastIndexOf("\\)", offset);
  return open > close;
}

export const toLatexText = convertCommonMathToLatex;

function replaceOutsideInlineMath(
  source: string,
  regex: RegExp,
  replacement: (match: string, firstGroup: string) => string,
  wrap = true,
) {
  return source.replace(regex, (...args: unknown[]) => {
    const match = String(args[0]);
    const firstGroup = typeof args[1] === "string" ? args[1] : "";
    const offset = Number(args[args.length - 2]);
    const fullSource = String(args[args.length - 1]);
    if (isInsideInlineMath(fullSource, offset)) return match;
    const latex = replacement(match, firstGroup);
    return wrap ? `\\(${latex}\\)` : latex;
  });
}

export function countLabelledItems(value: string) {
  return Array.from(value.matchAll(labelledItemRegex)).length;
}

export function typeFromLabel(value: string): RevisionItemType | undefined {
  const match = value.match(/\b(Definition|Theorem|Lemma|Proposition|Corollary|Proof|Remark|Example|Assumption|Property|Algorithm|Formula)\s*(?:[A-Za-z]?\d+(?:\.\d+)*)?\b/);
  if (!match) return undefined;
  const word = match[1].toLowerCase();
  if (word === "definition") return "definition";
  if (word === "theorem") return "theorem";
  if (word === "lemma") return "lemma";
  if (word === "proposition") return "proposition";
  if (word === "corollary") return "corollary";
  if (word === "proof") return "proof";
  if (word === "remark") return "remark";
  if (word === "example") return "example";
  if (word === "assumption") return "assumption";
  if (word === "property") return "property";
  if (word === "algorithm") return "algorithm";
  if (word === "formula") return "formula";
  return undefined;
}

export function extractNumber(value: string) {
  const match = value.match(/([A-Za-z]?\d+(?:\.\d+)+)/);
  return match ? match[1] : undefined;
}

export function theoremLike(type: RevisionItemType) {
  return ["theorem", "lemma", "proposition", "corollary"].includes(type);
}

function normaliseTitle(item: RevisionItem & { titleTopic?: string }) {
  const number = item.theoremNumber ?? extractNumber(item.title);
  const topic = item.titleTopic ?? topicFromItem(item);
  const prefix = `${capitalise(item.type)}${number ? ` ${number}` : ""}`;

  if (item.type === "definition" && topic) return `${prefix}. ${capitalise(topic)}`;
  if (item.type === "formula" && topic) return `Formula. ${capitalise(topic)}`;
  if (theoremLike(item.type)) return topic && !topic.match(/^theorem|lemma|proposition|corollary/i) ? `${prefix}. ${capitalise(topic)}` : prefix;
  if (item.type === "proof" && topic) return `Proof. ${capitalise(topic)}`;
  if (topic && item.title.length > 120) return `${prefix}. ${capitalise(topic)}`;
  return clean(item.title) || prefix;
}

function topicFromItem(item: Pick<RevisionItem, "type" | "title" | "statement">) {
  const titleTopic = item.title
    .replace(/^(Definition|Theorem|Lemma|Proposition|Corollary|Formula|Remark|Example|Proof|Assumption|Property)\s*[A-Za-z]?\d*(?:\.\d+)*[.:]?\s*/i, "")
    .trim();
  if (titleTopic && titleTopic.toLowerCase() !== item.type) return lowerFirst(titleTopic.replace(/[.:]\s*$/, ""));
  return inferTopic(item.type, item.statement)?.toLowerCase();
}

function buildExtractionWarning(item: Pick<RevisionItem, "title" | "statement" | "answer" | "type"> & { proof?: string }) {
  if (countLabelledItems(`${item.statement} ${item.proof ?? ""}`) > 1) return "Over-merged card: contains multiple labelled items.";
  if (item.type === "definition" && item.statement.length > 800) return "Definition is unusually long and may include unrelated text.";
  if (item.type === "definition" && /\b(Theorem|Proof|Remark|Definition|Lemma|Proposition|Corollary)\b/.test(item.statement)) {
    return "Over-merged card: contains multiple labelled items.";
  }
  if (theoremLike(item.type) && /\bDefinition\b[\s\S]*\bTheorem\b/.test(item.statement)) {
    return "Over-merged card: theorem statement contains earlier definition text.";
  }
  if (item.title.length > 140) return "Title is unusually long.";
  if (item.answer && item.answer.length > 2500) return "Answer is unusually long and may repeat a whole section.";
  if (/\b\d+(?:\.\d+)+\s+[A-Z][A-Za-z].{5,80}/.test(item.statement) && countLabelledItems(item.statement) > 0) {
    return "Statement appears to include unrelated section text.";
  }
  return undefined;
}

function cleanAnswer(type: RevisionItemType, statement: string, answer: string) {
  const cleaned = clean(answer);
  if (!cleaned || countLabelledItems(cleaned) > 1 || cleaned.length > Math.max(statement.length * 3, 1800)) return statement;
  if (type === "formula" && !/explain/i.test(cleaned)) return `${statement}\n\nExplain each term and the conditions under which the formula applies.`;
  return cleaned;
}

function trimProofAtBoundary(proof: string) {
  const qed = proof.search(/(?:□|∎|\bQED\b)/i);
  if (qed === -1) return proof;
  return proof.slice(0, qed + 1).trim();
}

function cleanTitle(title: string) {
  return title
    .replace(/^(Definition|Theorem|Lemma|Proposition|Corollary|Formula|Remark|Example|Proof|Assumption|Property)\s*/i, "")
    .replace(/[.:]\s*$/, "")
    .trim()
    .toLowerCase();
}

function clean(value = "") {
  return stripLeadingLabel(value).replace(/\s+/g, " ").trim();
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerFirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
