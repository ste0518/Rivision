import { createId } from "@/lib/utils";
import { inferTopic, splitShortLeadingTitle, stripLeadingLabel } from "@/lib/segmentation";
import type { RevisionItem, RevisionItemType } from "@/lib/types";

const labelledItemRegex = /\b(Definition|Theorem|Lemma|Proposition|Corollary|Proof|Remark|Example|Assumption|Property|Formula)\s*(?:[A-Za-z]?\d+(?:\.\d+)*)?\b/gi;
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
  const statementLatex = item.statementLatex ?? toLatexText(statement);
  const proofLatex = proof ? item.proofLatex ?? toLatexText(proof) : undefined;
  const answerLatex = item.answerLatex ?? toLatexText(answer);

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
    return `State ${numberedLabel} and explain the conditions under which it applies.`;
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

export function toLatexText(value: string) {
  let text = value
    .replace(/\bR\^([A-Za-z0-9]+)/g, "\\mathbb{R}^$1")
    .replace(/\bN\^?([A-Za-z0-9]*)\b/g, (_match, power: string) => (power ? `\\mathbb{N}^${power}` : "\\mathbb{N}"))
    .replace(/([A-Za-z0-9_)])\s+in\s+([A-Za-z0-9_{\\])/g, "$1 \\in $2")
    .replace(/([A-Za-z0-9_)])\s+subset\s+([A-Za-z0-9_{\\])/g, "$1 \\subset $2")
    .replace(/\bsigma\^2\b/gi, "\\sigma^2")
    .replace(/\bsigma\b/gi, "\\sigma")
    .replace(/\bmu\b/gi, "\\mu")
    .replace(/\bSigma\b/g, "\\Sigma")
    .replace(/\bgamma\b/gi, "\\gamma");

  text = text.replace(/([A-Z])=\(([^)]+)\)_\{([^}]+)\}/g, (_match, lhs: string, inner: string, subscript: string) => {
    const compactSubscript = subscript.replace(/\s*\\in\s*/g, "\\in ");
    return `\\(${lhs}=(${inner})_{${compactSubscript}}\\)`;
  });
  text = text.replace(/\\mathbb\{R\}\^([A-Za-z0-9]+)/g, (match, _power: string, offset: number, source: string) =>
    source.slice(Math.max(0, offset - 2), offset) === "\\(" ? match : `\\(${match}\\)`,
  );
  text = text.replace(/\\mathbb\{N\}(?:\^([A-Za-z0-9]+))?/g, (match, _power: string, offset: number, source: string) =>
    source.slice(Math.max(0, offset - 2), offset) === "\\(" ? match : `\\(${match}\\)`,
  );
  return text;
}

export function countLabelledItems(value: string) {
  return Array.from(value.matchAll(labelledItemRegex)).length;
}

export function typeFromLabel(value: string): RevisionItemType | undefined {
  const match = value.match(/\b(Definition|Theorem|Lemma|Proposition|Corollary|Proof|Remark|Example|Assumption|Property|Formula)\s*(?:[A-Za-z]?\d+(?:\.\d+)*)?\b/i);
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
  if (countLabelledItems(`${item.statement} ${item.proof ?? ""}`) > 1) return "This card may contain multiple merged items.";
  if (item.type === "definition" && item.statement.length > 1500) return "Definition is unusually long and may include unrelated text.";
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
