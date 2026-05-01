import { createId } from "@/lib/utils";
import { inferTopic, splitShortLeadingTitle, stripLeadingLabel } from "@/lib/segmentation";
import type { LatexQualityReport, RevisionCandidate, RevisionItem, RevisionItemType } from "@/lib/types";
import { priorityLabelFromScore, revisionPackCategoryForItem } from "@/lib/course-priority";

const labelledItemRegex = /\b(Definition|Theorem|Lemma|Proposition|Corollary|Proof|Remark|Example|Question|Assumption|Property|Algorithm|Formula)\s*(?:[A-Za-z]?\d+(?:\.\d+)*)?\b/g;
const proofMarkerRegex = /\bProof(?:\s+of\s+(?:Theorem|Lemma|Proposition|Corollary)\s*[A-Za-z]?\d*(?:\.\d+)*)?\s*[:.]/i;

export function normaliseRevisionItem(item: RevisionItem): RevisionItem {
  const now = new Date().toISOString();
  const originalRawText = item.originalRawText ?? item.statement;
  const correctedType = typeFromLabel(item.title) ?? typeFromLabel(item.originalRawText ?? "") ?? typeFromLabel(item.statement) ?? item.type;
  const repairedStatement = cleanupStatementBoundary(correctedType, repairSuspiciousStatementFromRaw(correctedType, item.statement, originalRawText));
  const split = splitProofFromStatement(repairedStatement);
  const statementParts = splitShortLeadingTitle(split.statement);
  const statement = clean(cleanupStatementBoundary(correctedType, statementParts.statement));
  const proof = cleanPlainText(item.proof ?? split.proof ?? "");
  const theoremNumber = item.theoremNumber ?? extractNumber(item.title) ?? extractNumber(item.originalRawText ?? "") ?? extractNumber(item.sourceLocation ?? "");
  const extractedConceptName = extractConceptName(undefined, { ...item, type: correctedType, theoremNumber, statement, titleTopic: statementParts.title });
  const conceptName = (isUsableConceptName(item.conceptName) ? item.conceptName : extractedConceptName) || correctedType;
  const displayTitle = buildDisplayTitle(correctedType, theoremNumber, conceptName, item.displayTitle ?? item.title);
  const cardFront = buildCardFront({ ...item, type: correctedType, theoremNumber, conceptName, displayTitle });
  const title = normaliseTitle({ ...item, type: correctedType, theoremNumber, statement, titleTopic: statementParts.title, conceptName, displayTitle });
  const extractionWarning = item.extractionWarning ?? buildExtractionWarning({ ...item, type: correctedType, title, statement, proof });
  const proofRequired = theoremLike(correctedType) ? (/\bnot examinable|non-examinable|not required\b/i.test(`${statement} ${proof}`) ? false : item.proofRequired) : undefined;
  const cardPurpose = item.cardPurpose ?? inferCardPurpose(correctedType, title, statement, proofRequired);
  const taskPrompt = specificTaskPrompt(conceptName) ?? item.taskPrompt ?? buildTaskPrompt(correctedType, Boolean(proofRequired), cardPurpose);
  const answer = cleanAnswer(correctedType, statement, item.answer);
  const statementLatex = repairMathTextToLatex(item.statementLatex || statement);
  const proofLatex = proof ? repairMathTextToLatex(item.proofLatex || proof) : undefined;
  const answerLatex = repairMathTextToLatex(item.answerLatex || answer);
  const latexReport = validateLatexQuality({ ...item, statementLatex, proofLatex, answerLatex } as RevisionItem);
  const genericConcept = isGenericConceptName(conceptName);
  const forceNeedsReview = latexReport.score === "low" || genericConcept;

  return {
    ...item,
    id: item.id || createId("card"),
    type: correctedType,
    title,
    conceptName,
    displayTitle,
    cardFront,
    taskPrompt,
    cardPurpose,
    curationStatus: item.curationStatus ?? ((item.curationDecision ?? (forceNeedsReview ? "needs_review" : "keep")) === "needs_review" ? "needs_review" : "kept"),
    curationDecision: item.curationDecision ?? (forceNeedsReview ? "needs_review" : "keep"),
    curationReason: item.curationReason ?? (genericConcept ? "Generic concept name requires manual review." : latexReport.score === "low" ? "Low LaTeX quality requires manual review." : undefined),
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
    priorityScore: item.priorityScore ?? 0,
    priorityLabel: item.priorityLabel ?? priorityLabelFromScore(item.priorityScore ?? 0),
    evidenceSignals: item.evidenceSignals ?? [],
    whyThisCardMatters: item.whyThisCardMatters ?? item.relevanceReason ?? item.curationReason ?? "Needs priority evidence.",
    revisionPackCategory: item.revisionPackCategory ?? revisionPackCategoryForItem({ ...item, type: correctedType, cardPurpose }),
    classificationConfidence: item.classificationConfidence ?? (extractionWarning ? "low" : "medium"),
    warnings: [
      ...(item.warnings ?? []),
      ...(genericConcept ? ["Generic concept name."] : []),
      ...(latexReport.score === "low" ? ["Low LaTeX quality."] : []),
      ...latexReport.issues,
    ],
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
  return normalizeExtractedMathText(value);
}

export function repairMathTextToLatex(value: string) {
  return normalizeExtractedMathText(value);
}

export function normalizeExtractedMathText(value: string): string {
  return normalizeMathNotation(value);
}

export function normalizeMathNotation(value: string) {
  let text = cleanPlainText(value);

  text = text
    .replace(/\uFFFE/g, "")
    .replace(/\u0000/g, "")
    .replace(/\bmulti\s*variate\b/gi, "multivariate")
    .replace(/\bdis\s*tribution\b/gi, "distribution")
    .replace(/\bsemi\s*variogram\b/gi, "semi-variogram")
    .replace(/\bnormal\s+distribution\b/gi, "normal distribution")
    .replace(/\bprobability\s+density\b/gi, "probability density")
    .replace(/\bGaus\s*sian\b/gi, "Gaussian")
    .replace(/normal\s+dis-\s*['’]?\s*n\s*tribution/gi, "normal distribution")
    .replace(/dis-\s*['’]?\s*n\s*tribution/gi, "distribution")
    .replace(/\s+['’]\s*n\s+/g, " ");

  text = replaceOutsideInlineMath(
    text,
    /\bA random vector\s+(?:X\s*=\s*)?\(\s*X_?1\s*,\s*(?:\.\s*){2,}\s*,?\s*X_?n\s*\)\s*['’]/gi,
    () => "A random vector \\(X=(X_1,\\ldots,X_n)'\\)",
    false,
  );

  text = replaceOutsideInlineMath(
    text,
    /\(\s*X_?1\s*,\s*(?:\.\s*){2,}\s*,?\s*X_?n\s*\)\s*['’]/g,
    () => "\\((X_1,\\ldots,X_n)'\\)",
    false,
  );

  text = replaceOutsideInlineMath(
    text,
    /\bm\s*=\s*\(\s*E\s*X_?1\s*,\s*(?:\.\s*){2,}\s*,?\s*E\s*X_?n\s*\)\s*['’]?\s+in\s+R\s*\^?\s*n\b/gi,
    () => "\\(m=(\\mathbb{E}X_1,\\ldots,\\mathbb{E}X_n)'\\in\\mathbb{R}^n\\)",
    false,
  );

  text = replaceOutsideInlineMath(
    text,
    /\b(?:Sigma|Σ)\s*[’']\s*n\s*(?:Sigma|Σ)\s+with entries\s+(?:Sigma|Σ)_?\s*ij\s*=\s*Cov\s*\(\s*X_?i\s*,\s*X_?j\s*\)/gi,
    () => "\\(\\Sigma\\in\\mathbb{R}^{n\\times n}\\) with entries \\(\\Sigma_{ij}=\\operatorname{Cov}(X_i,X_j)\\)",
    false,
  );

  text = replaceOutsideInlineMath(text, /\bn\s*x\s*n\b/gi, () => "n\\times n");
  text = replaceOutsideInlineMath(text, /\bmu\b/gi, () => "\\mu");
  text = replaceOutsideInlineMath(text, /\brho\b/gi, () => "\\rho");

  text = replaceOutsideInlineMath(
    text,
    /\ba\s*['’]\s*X\s*=\s*sum_?i\s*=\s*1\s*\^?\s*n\s*a_?i\s*X_?i\b/gi,
    () => "\\(a'X=\\sum_{i=1}^n a_iX_i\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\ba\s*[′']\s*X\s*=\s*(?:P|∑|sum)\s*n?\s*i\s*=\s*1\s*a_?i\s*X_?i\b/gi,
    () => "\\(a'X=\\sum_{i=1}^n a_iX_i\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\ba\s+X\s*=\s*i\s*=\s*1\s*a\s*\.?\s*i\s*X\s*\.?\s*i\b/gi,
    () => "\\(a'X=\\sum_{i=1}^n a_iX_i\\)",
    false,
  );
  text = replaceOutsideInlineMath(text, /\ba\s+in\s+R\s*\^?\s*n\b/gi, () => "\\(a\\in\\mathbb{R}^n\\)", false);

  text = replaceOutsideInlineMath(
    text,
    /\bF\s*t1\s*,\s*\.\.\.\s*,\s*tn\s*\(\s*x1\s*,\s*\.\.\.\s*,\s*xn\s*\)/gi,
    () => "\\(F_{t_1,\\ldots,t_n}(x_1,\\ldots,x_n)\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bP\s*\(\s*X\s*t1\s*<=\s*x1\s*,\s*\.\.\.\s*,\s*X\s*tn\s*<=\s*xn\s*\)/gi,
    () => "\\(\\mathbb{P}(X_{t_1}\\le x_1,\\ldots,X_{t_n}\\le x_n)\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bX\s*=\s*\(\s*X\s*_?\s*t\s*\)\s*(?:_\{\s*t\s*(?:in|∈|\\in)\s*T\s*\}|\s*t\s*(?:in|∈)\s*T)/gi,
    () => "\\(X=(X_t)_{t\\in T}\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bT\s*(?:⊆|\\subseteq|subset(?:eq)?|is a subset of)\s*R\s*\^?\s*d\b/gi,
    () => "\\(T\\subseteq\\mathbb{R}^d\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bT\s*(?:⊆|\\subseteq|subset(?:eq)?)\s*Rd\b/gi,
    () => "\\(T\\subseteq\\mathbb{R}^d\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /(?:Σ|Sigma)_?\s*i\s*,?\s*j\s*=\s*Cov\s*\(\s*X_?i\s*,\s*X_?j\s*\)/gi,
    () => "\\(\\Sigma_{ij}=\\operatorname{Cov}(X_i,X_j)\\)",
    false,
  );
  text = replaceOutsideInlineMath(text, /\bSigma_?\s*ij\s*=\s*Cov\s*\(\s*X_?i\s*,\s*X_?j\s*\)/gi, () => "\\(\\Sigma_{ij}=\\operatorname{Cov}(X_i,X_j)\\)", false);
  text = replaceOutsideInlineMath(text, /\bΣ_?\s*ij\s*=\s*Cov\s*\(\s*Xi\s*,\s*Xj\s*\)/g, () => "\\(\\Sigma_{ij}=\\operatorname{Cov}(X_i,X_j)\\)", false);
  text = replaceOutsideInlineMath(text, /\bSigma\b/g, () => "\\Sigma");
  text = replaceOutsideInlineMath(text, /\bΣ\b/g, () => "\\Sigma");
  text = replaceOutsideInlineMath(text, /\bCov\b/g, () => "\\operatorname{Cov}");
  text = replaceOutsideInlineMath(
    text,
    /ρ\s*:\s*T\s*(?:×|x)\s*T\s*(?:→|->|to)\s*R\b/g,
    () => "\\(\\rho:T\\times T\\to\\mathbb{R}\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /ρ\s*\(\s*t_?i\s*,\s*t_?j\s*\)/g,
    () => "\\(\\rho(t_i,t_j)\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /γ\s*:\s*R\s*\^?\s*d\s*(?:→|->|to)\s*R\s*\+?/g,
    () => "\\(\\gamma:\\mathbb{R}^d\\to\\mathbb{R}_+\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /γ\s*:\s*Rd\s*(?:→|->|to)\s*R\s*\+?/g,
    () => "\\(\\gamma:\\mathbb{R}^d\\to\\mathbb{R}_+\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /(?:Xˆ|ˆ\s*X|X\s*hat|hat\s*X)\s*t_?0\s*=\s*m\s*\(\s*t_?0\s*\)\s*\+\s*K[′']\s*Σ\s*[-−]?\s*1\s*\(\s*Z\s*[-−]\s*M\s*\)/gi,
    () => "\\(\\hat X_{t_0}=m(t_0)+K'\\Sigma^{-1}(Z-M)\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bindexed by t in a subset T of R\s*\^?\s*d\b/gi,
    () => "indexed by \\(t\\) in a subset \\(T\\subset\\mathbb{R}^d\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bT\s+of\s+R\s*d\b/gi,
    () => "\\(T\\subseteq\\mathbb{R}^d\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bsubset T of R\s*\^?\s*d\b/gi,
    () => "subset \\(T\\subset\\mathbb{R}^d\\)",
    false,
  );
  text = replaceOutsideInlineMath(
    text,
    /\bX_?1\s*,\s*(?:\.\s*){2,}\s*,?\s*X_?n\b/gi,
    () => "\\(X_1,\\ldots,X_n\\)",
    false,
  );
  text = replaceOutsideInlineMath(text, /\bX_t\b/g, () => "\\(X_t\\)", false);
  text = replaceOutsideInlineMath(text, /\bX\s+t\b/g, () => "\\(X_t\\)", false);
  text = replaceOutsideInlineMath(text, /\bX\s+i\b/g, () => "\\(X_i\\)", false);
  text = replaceOutsideInlineMath(text, /\bX\s+j\b/g, () => "\\(X_j\\)", false);
  text = replaceOutsideInlineMath(text, /\bXi\b/g, () => "\\(X_i\\)", false);
  text = replaceOutsideInlineMath(text, /\bXj\b/g, () => "\\(X_j\\)", false);
  text = replaceOutsideInlineMath(text, /\bXt1\b/g, () => "\\(X_{t_1}\\)", false);
  text = replaceOutsideInlineMath(text, /\bXtn\b/g, () => "\\(X_{t_n}\\)", false);
  text = replaceOutsideInlineMath(text, /\bXt\b/g, () => "\\(X_t\\)", false);
  text = replaceOutsideInlineMath(text, /\bXs\b/g, () => "\\(X_s\\)", false);
  text = replaceOutsideInlineMath(text, /\bX1\b/g, () => "\\(X_1\\)", false);
  text = replaceOutsideInlineMath(text, /\bXn\b/g, () => "\\(X_n\\)", false);
  text = replaceOutsideInlineMath(text, /\bt1\b/g, () => "\\(t_1\\)", false);
  text = replaceOutsideInlineMath(text, /\btn\b/g, () => "\\(t_n\\)", false);
  text = replaceOutsideInlineMath(text, /\bx1\b/g, () => "\\(x_1\\)", false);
  text = replaceOutsideInlineMath(text, /\bxn\b/g, () => "\\(x_n\\)", false);
  text = replaceOutsideInlineMath(text, /\bt\s+in\s+T\b/g, () => "\\(t\\in T\\)", false);
  text = replaceOutsideInlineMath(text, /\bt\s*∈\s*T\b/g, () => "\\(t\\in T\\)", false);
  text = replaceOutsideInlineMath(text, /\bT\s+subset\s+R\^?d\b/gi, () => "\\(T\\subset\\mathbb{R}^d\\)", false);
  text = replaceOutsideInlineMath(text, /\bR\s*\+\b/g, () => "\\mathbb{R}_+");
  text = replaceOutsideInlineMath(text, /\bx\s+in\s+R\b/gi, () => "\\(x\\in\\mathbb{R}\\)", false);
  text = replaceOutsideInlineMath(text, /\bR\^([A-Za-z0-9]+)\b/g, (_match, power) => `\\mathbb{R}^${power}`);
  text = replaceOutsideInlineMath(text, /\bR\s+d\b/g, () => "\\mathbb{R}^d");
  text = replaceOutsideInlineMath(text, /\bR\s+n\b/g, () => "\\mathbb{R}^n");
  text = replaceOutsideInlineMath(text, /\bsigma\^2\b/gi, () => "\\sigma^2");
  text = replaceOutsideInlineMath(text, /\bsigma\b/gi, () => "\\sigma");
  text = replaceOutsideInlineMath(text, /\bgamma\b/gi, () => "\\gamma");
  text = replaceOutsideInlineMath(text, /\ba[′']X\s*=\s*Pn\s*i\s*=\s*1\s*a_?i\s*X_?i\b/gi, () => "\\(a'X=\\sum_{i=1}^n a_iX_i\\)", false);
  text = replaceOutsideInlineMath(text, /\bPn\s*i\s*=\s*1\s*a_?i\s*X_?i\b/gi, () => "\\sum_{i=1}^n a_iX_i");
  text = replaceOutsideInlineMath(text, /\bsum_i\s*=\s*1\^n\s*a_iX_i\b/gi, () => "\\sum_{i=1}^n a_iX_i");
  text = replaceOutsideInlineMath(text, /\bm\s*:\s*T\s*(?:→|->|to)\s*R\b/g, () => "\\(m:T\\to\\mathbb{R}\\)", false);
  text = replaceOutsideInlineMath(text, /\bK[′']\s*Σ\s*[-−]\s*1\b/g, () => "\\(K'\\Sigma^{-1}\\)", false);
  text = replaceOutsideInlineMath(text, /ρ\s*\(\s*t0\s*,\s*t0\s*\)/g, () => "\\(\\rho(t_0,t_0)\\)", false);
  text = text.replace(/\\\(\s*\\\(/g, "\\(").replace(/\\\)\s*\\\)/g, "\\)");

  return text;
}

function isInsideInlineMath(source: string, offset: number) {
  const open = source.lastIndexOf("\\(", offset);
  const close = source.lastIndexOf("\\)", offset);
  return open > close;
}

export const toLatexText = convertCommonMathToLatex;

export function validateLatexQuality(item: RevisionItem): LatexQualityReport {
  const target = `${item.statementLatex || ""}\n${item.answerLatex || ""}\n${item.proofLatex || ""}`.trim();
  const issues: string[] = [];
  if (!target) return { score: "low", issues: ["Missing LaTeX content."] };
  if (/\bXt1\b|\bXtn\b/.test(target)) issues.push("Contains raw Xt1/Xtn tokens.");
  if (/\bX1\b|\bXn\b/.test(target)) issues.push("Contains raw X1/Xn tokens in math context.");
  if (/\bR\s+[dn]\b/.test(target)) issues.push("Contains raw R d / R n notation.");
  if (/\bSigma\b/.test(target)) issues.push("Contains raw Sigma token.");
  if (/\brho\b|\bgamma\b/.test(target)) issues.push("Contains raw rho/gamma token.");
  if (/\bPn\s*i\s*=\s*1\b|\bsum_i\b/.test(target)) issues.push("Contains raw summation notation.");
  if (/\uFFFE/.test(target)) issues.push("Contains PDF extraction artefact.");
  if (/dis-\s*/i.test(target)) issues.push("Contains broken hyphenation.");
  const openCount = (target.match(/\\\(/g) ?? []).length;
  const closeCount = (target.match(/\\\)/g) ?? []).length;
  if (openCount !== closeCount) issues.push("Unmatched inline math delimiters.");
  const score: LatexQualityReport["score"] = issues.length >= 3 ? "low" : issues.length > 0 ? "medium" : "high";
  return { score, issues };
}

function replaceOutsideInlineMath(
  source: string,
  regex: RegExp,
  replacement: (match: string, ...captures: string[]) => string,
  wrap = true,
) {
  return source.replace(regex, (...args: unknown[]) => {
    const match = String(args[0]);
    const captures = args.slice(1, -2).map((capture) => String(capture));
    const offset = Number(args[args.length - 2]);
    const fullSource = String(args[args.length - 1]);
    if (isInsideInlineMath(fullSource, offset)) return match;
    const latex = replacement(match, ...captures);
    return wrap ? `\\(${latex}\\)` : latex;
  });
}

export function countLabelledItems(value: string) {
  return Array.from(value.matchAll(labelledItemRegex)).length;
}

export function typeFromLabel(value: string): RevisionItemType | undefined {
  const match = value.match(/\b(Definition|Theorem|Lemma|Proposition|Corollary|Proof|Remark|Example|Question|Assumption|Property|Algorithm|Formula)\s*(?:[A-Za-z]?\d+(?:\.\d+)*)?\b/);
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
  if (word === "question") return "example";
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

type ConceptItem = Pick<RevisionItem, "type" | "title" | "statement"> & {
  theoremNumber?: string;
  conceptName?: string;
  displayTitle?: string;
  titleTopic?: string;
  proofRequired?: boolean;
};

export function extractConceptName(candidate: RevisionCandidate | undefined, item: ConceptItem) {
  const type = candidate?.label ? candidate.label.toLowerCase() : item.type;
  const number = candidate?.number ?? item.theoremNumber ?? extractNumber(item.title);
  const statement = cleanPlainText(item.statement);
  const explicitTitle = item.titleTopic ?? cleanLabelFromTitle(item.title);
  const explicitTitleConcept = normaliseConceptPhrase(explicitTitle);

  if (type === "definition") {
    if (/\bsemi-?variogram\b/i.test(statement) && /\bdefined by\b|\bis defined\b/i.test(statement)) return "Semi-variogram";
    if (/\bnugget effect\b/i.test(statement)) return "Nugget effect";
    if (/\bpractical range\b/i.test(statement) && /\bsill\b/i.test(statement)) return "Sill, range, practical range";
    if (/\bisotropic covariance\b/i.test(statement)) return "Isotropic covariance";
    if (/\bisotropic spectral density\b/i.test(statement)) return "Isotropic spectral density";
    if (/\bisotropic semi-?variogram\b/i.test(statement)) return "Isotropic semi-variogram";
    if (/\bgeometric anisotropy\b/i.test(statement)) return "Geometric anisotropy";
    if (/\bstratified\b|\bzonal anisotropy\b/i.test(statement)) return "Stratified / zonal anisotropy";
    if (/\bsmoothed Matheron estimator\b/i.test(statement)) return "Smoothed Matheron estimator";
    if (/\bspectral density function\b/i.test(statement)) return "Spectral density";

    const stationarity = statement.match(/^(?:A|An|The)\s+[^.!?]{1,80}?\s+is\s+(weakly|strictly|intrinsically|second-order)\s+stationary\s+if\b/i);
    if (stationarity) return capitaliseConcept(`${stationarity[1].replace(/ly$/i, "")} stationarity`);

    const grfMatch = statement.match(/\b(?:is|are)\s+(?:a|an|the)?\s*Gaussian random field\b/i);
    if (grfMatch) return "Gaussian random field";

    const defineMatch = statement.match(/\bWe define\s+(?:a|an|the)?\s*([A-Za-z][A-Za-z\s-]{2,70}?)(?:\s+as|\s+to be|\s+by|[.:])/i);
    if (defineMatch) return capitaliseConcept(normaliseConceptPhrase(defineMatch[1]) || explicitTitleConcept || "Definition");

    const familyMatch = statement.match(/\bThe family\s+[^.!?]{0,120}?\s+is\s+(?:a|an)\s+([A-Za-z][A-Za-z\s-]{2,70}?)\s+if\b/i);
    if (familyMatch) return capitaliseConcept(normaliseConceptPhrase(familyMatch[1]) || explicitTitleConcept || "Definition");

    const hasMatch = statement.match(/\bhas an?\s+(isotropic covariance|isotropic spectral density function|isotropic semi-?variogram)\s+if\b/i);
    if (hasMatch) {
      if (/spectral/i.test(hasMatch[1])) return "Isotropic spectral density";
      if (/semi/i.test(hasMatch[1])) return "Isotropic semi-variogram";
      return "Isotropic covariance";
    }

    if (/The semi-variogram exhibits geometric anisotropy if/i.test(statement)) return "Geometric anisotropy";
    if (/The semi-variogram exhibits stratified or zonal anisotropy if/i.test(statement)) return "Stratified / zonal anisotropy";

    const articleMatch = statement.match(/^(?:A|An|The)\s+([A-Za-z][A-Za-z\s-]{1,60}?)(?:\s*\([^)]{0,120}\)\s*['’]?)?\s+(?:is|are|has|means|denotes|consists|refers)\b/i);
    if (articleMatch) return capitaliseConcept(normaliseConceptPhrase(articleMatch[1]) || explicitTitleConcept || "Definition");

    const processMatch = statement.match(/^(?:A|An|The)\s+process\s+is\s+([A-Za-z\s-]{2,60}?)\s+if\b/i);
    if (processMatch) return capitaliseConcept(normaliseConceptPhrase(processMatch[1]) || explicitTitleConcept || "Process");

    const sayMatch = statement.match(/\bWe say that\b[^.!?]{0,120}?\bis\s+(.+?)(?:\s+if\b|[.;,:]|$)/i);
    if (sayMatch) {
      const normalized = normaliseConceptPhrase(sayMatch[1]);
      if (/weakly stationary/i.test(normalized)) return "Weak stationarity";
      if (/strictly stationary/i.test(normalized)) return "Strict stationarity";
      if (/isotropic/i.test(normalized)) return "Isotropy";
      return capitaliseConcept(normalized || explicitTitleConcept || "Definition");
    }

    const calledMatch = statement.match(/\bis called\s+(.+?)(?:\s+if\b|[.;,:]|$)/i);
    if (calledMatch) return capitaliseConcept(normaliseConceptPhrase(calledMatch[1]) || explicitTitleConcept || "Definition");

    const inferred = capitaliseConcept(explicitTitleConcept || inferTopic("definition", statement) || "Definition");
    return isGenericConceptName(inferred) ? (number ? `Definition ${number}` : "Definition") : inferred;
  }

  if (theoremLike(item.type)) {
    if (number === "2.5" || /\bpositive semi-definite\b/i.test(statement) && /\bcovariance function\b/i.test(statement)) return "Covariance function validity";
    if (number === "3.2" || /\bsimple Kriging\b/i.test(statement)) return "Simple Kriging";
    if (number === "3.3" || /\bordinary Kriging\b/i.test(statement)) return "Ordinary Kriging";
    if (/\bBochner'?s theorem\b/i.test(item.title) || /\bspectral measure\b/i.test(statement)) return "Bochner's theorem";
    if (number === "2.2" || /\bjoint cumulative distribution\b/i.test(statement)) return "Random field finite-dimensional distributions";
    if (explicitTitleConcept && !/^(theorem|lemma|proposition|corollary)(\s+\d|\b)/i.test(explicitTitleConcept)) {
      return capitaliseConcept(explicitTitleConcept);
    }
    return `${capitalise(item.type)}${number ? ` ${number}` : ""}`.trim();
  }

  if (item.type === "formula") {
    const formulaTitle = explicitTitleConcept && explicitTitleConcept.toLowerCase() !== "formula" ? explicitTitleConcept : undefined;
    const namedFormula = statement.match(/\b(?:formula|equation)\s+for\s+([^.:;,]+)/i)?.[1] ??
      statement.match(/\b(?:The\s+)?(semivariogram|covariance function|BLUP|kriging predictor)\b/i)?.[1];
    const formulaName = capitaliseConcept(normaliseConceptPhrase(formulaTitle || namedFormula || "Formula"));
    return isGenericConceptName(formulaName) ? (number ? `Formula ${number}` : "Formula") : formulaName;
  }

  if (item.type === "proof") {
    return number ? `Proof of Theorem ${number}` : capitaliseConcept(explicitTitleConcept || "Proof");
  }

  return capitaliseConcept(explicitTitleConcept || inferTopic(item.type, statement) || cleanTitle(item.title) || capitalise(item.type));
}

function buildDisplayTitle(type: RevisionItemType, number: string | undefined, conceptName: string, fallbackTitle: string) {
  const label = `${capitalise(type)}${number ? ` ${number}` : ""}`;
  if (type === "definition" && conceptName && conceptName.toLowerCase() !== "definition") return `${label}. ${conceptName}`;
  if (type === "formula" && conceptName && conceptName.toLowerCase() !== "formula") return `${label}. ${conceptName}`;
  if (theoremLike(type) && conceptName && !/^(theorem|lemma|proposition|corollary)(\s+\d|\b)/i.test(conceptName)) return `${label}. ${conceptName}`;
  if (theoremLike(type) || type === "proof") return label.trim() || fallbackTitle;
  if (conceptName) return number ? `${label}. ${conceptName}` : conceptName;
  return fallbackTitle || label;
}

function buildCardFront(item: ConceptItem) {
  if (item.type === "proof") return item.theoremNumber ? `Proof of Theorem ${item.theoremNumber}` : item.conceptName || item.displayTitle || item.title;
  return item.conceptName || item.displayTitle || item.title;
}

function inferCardPurpose(type: RevisionItemType, title: string, statement: string, proofRequired?: boolean): RevisionItem["cardPurpose"] {
  const lower = `${title} ${statement}`.toLowerCase();
  if (type === "proof" || proofRequired) return "proof_recall";
  if (type === "definition") {
    if (/\b(vs|versus|difference|distinction|strict|weak)\b/.test(lower) && /\bstationarity|stationary\b/.test(lower)) return "conceptual_distinction";
    return "definition_recall";
  }
  if (theoremLike(type)) return "theorem_statement";
  if (type === "formula") {
    if (/\bkriging system|ordinary kriging|set up|calculate|solve\b/.test(lower)) return "calculation_template";
    return "formula_recall";
  }
  if (type === "algorithm") return "method_steps";
  if (/\bcondition|applies|valid|when can|if and only if\b/.test(lower)) return "application_condition";
  if (/\b(vs|versus|difference|distinction|compare|strict|weak)\b/.test(lower)) return "conceptual_distinction";
  return "definition_recall";
}

function buildTaskPrompt(type: RevisionItemType, proofRequired: boolean, purpose: RevisionItem["cardPurpose"]) {
  if (purpose === "conceptual_distinction") return "Explain the difference and implication relationship.";
  if (purpose === "calculation_template") return "Set up the calculation template.";
  if (purpose === "method_steps") return "Recall the method steps.";
  if (purpose === "application_condition") return "State when this applies.";
  if (type === "definition") return "Recall the exact definition.";
  if (type === "formula") return "Write down the formula and explain each term.";
  if (type === "proof" || proofRequired) return "Reproduce the proof.";
  if (theoremLike(type)) return "State the theorem and its conditions.";
  return "Recall the key statement.";
}

function specificTaskPrompt(conceptName: string | undefined) {
  if (conceptName === "Covariance function validity") return "State the positive semi-definiteness condition.";
  if (conceptName === "Simple Kriging") return "State the BLUP predictor and mean squared prediction error.";
  if (conceptName === "Ordinary Kriging") return "State the BLUP predictor and mean squared prediction error.";
  return undefined;
}

function normaliseTitle(item: RevisionItem & { titleTopic?: string }) {
  const number = item.theoremNumber ?? extractNumber(item.title);
  if (item.displayTitle) return item.displayTitle;
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

function cleanLabelFromTitle(title: string) {
  return title
    .replace(/^(Definition|Theorem|Lemma|Proposition|Corollary|Formula|Remark|Example|Proof|Assumption|Property)\s*[A-Za-z]?\d*(?:\.\d+)*[.:]?\s*/i, "")
    .replace(/[.:]\s*$/, "")
    .trim();
}

function clean(value = "") {
  return stripLeadingLabel(cleanPlainText(value)).replace(/\s+/g, " ").trim();
}

function cleanPlainText(value = "") {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\b([A-Za-z]{2,})-\s*(?:'\s*n\s*)?([a-z]{2,})\b/g, (_match, left: string, right: string) => `${left}${right}`)
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function repairSuspiciousStatementFromRaw(type: RevisionItemType, statement: string, originalRawText: string) {
  const cleaned = cleanPlainText(statement);
  if (type !== "definition" || !isSuspiciousStatementStart(cleaned)) return cleaned;
  const rawStatement = clean(stripLeadingLabel(originalRawText));
  if (rawStatement && !isSuspiciousStatementStart(rawStatement) && rawStatement.length > cleaned.length) return rawStatement;
  return cleaned;
}

function isSuspiciousStatementStart(statement: string) {
  return /^(?:[,.;:)]|\]|\.\.\.|…|Xn\)|X_n\)|,\s*Xn\)|,\s*X_n\))/i.test(statement.trim());
}

function normaliseConceptPhrase(value = "") {
  const withoutMath = value
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\b(?:a|an|the)\b\s*/i, "")
    .replace(/\b(?:is|are|has|if|then|where|with|such that)\b[\s\S]*$/i, "")
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = withoutMath.split(" ").filter((word) => word.length > 0).slice(0, 6);
  return words.join(" ");
}

function capitaliseConcept(value: string) {
  const cleaned = normaliseConceptPhrase(value);
  if (!cleaned) return "";
  return cleaned
    .split(/\s+/)
    .map((word, index) => {
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

function isUsableConceptName(value: string | undefined) {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length > 80 || trimmed.split(/\s+/).length > 8) return false;
  if (/^(state|prove|explain|write down)\b/i.test(trimmed)) return false;
  if (/[,;:]|\\\(|\)|\.\.\.|…/.test(trimmed)) return false;
  if (isGenericConceptName(trimmed)) return false;
  return true;
}

export function isGenericConceptName(value: string | undefined) {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length > 80 || /,$/.test(trimmed)) return true;
  return /^(definition|theorem|formula|remark|question|example)(?:\s+\d+(?:\.\d+)*)?$/i.test(trimmed);
}

function cleanupStatementBoundary(type: RevisionItemType, value: string) {
  if (type !== "definition") return value;
  const boundaries = [
    /\b(?:Definition|Theorem|Lemma|Proposition|Corollary|Remark|Example|Question|Proof)\s+\d+(?:\.\d+)*\b/i,
    /\b(?:Chapter|Section)\s+\d+(?:\.\d+)*\b/i,
    /\bThis definition allows us to\b/i,
    /\bWe now\b/i,
    /\bThe following theorem\b/i,
  ];
  let end = value.length;
  for (const boundary of boundaries) {
    const match = value.match(boundary);
    if (match?.index !== undefined && match.index > 20) end = Math.min(end, match.index);
  }
  return value.slice(0, end).trim();
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerFirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}
