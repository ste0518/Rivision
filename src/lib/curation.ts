import { attachProofsToPreviousTheorem, segmentRevisionCandidates, stripLeadingLabel } from "@/lib/segmentation";
import {
  buildQuestionPrompt,
  convertCommonMathToLatex,
  extractConceptName,
  extractNumber,
  isGenericConceptName,
  splitProofFromStatement,
  theoremLike,
  validateLatexQuality,
} from "@/lib/revision-item-utils";
import type {
  CandidateRelevanceScore,
  CandidateRevisionBlock,
  CourseKnowledgeMap,
  CourseSection,
  CourseStructureMap,
  CourseTopic,
  CuratedDeckResult,
  CurationReport,
  EmbeddedRevisionItem,
  ParsedDocument,
  RejectedRevisionItem,
  RejectionCategory,
  RevisionItem,
  RevisionItemType,
} from "@/lib/types";
import { createId } from "@/lib/utils";

type CurationInput = {
  candidates?: CandidateRevisionBlock[];
  guidanceDocuments: ParsedDocument[];
  parsedNotes: ParsedDocument[];
};

type ScoredCandidate = {
  candidate: CandidateRevisionBlock;
  item: RevisionItem;
  score: CandidateRelevanceScore;
};

const centralFormulaTerms = [
  "semivariogram",
  "variogram",
  "covariance function",
  "blup",
  "kriging predictor",
  "kriging system",
  "ordinary kriging",
  "simple kriging",
  "poisson process",
  "likelihood",
  "intensity",
  "conditional distribution",
  "local characteristic",
  "sar",
  "car",
];

const centralTopicTerms = [
  "random field",
  "random vector",
  "stationarity",
  "strict stationarity",
  "weak stationarity",
  "intrinsic stationarity",
  "isotropy",
  "covariance",
  "semivariogram",
  "variogram",
  "kriging",
  "blup",
  "gaussian",
  "poisson",
  "conditional distribution",
];

export async function curateRevisionDeck({
  candidates,
  guidanceDocuments,
  parsedNotes,
}: CurationInput): Promise<CuratedDeckResult> {
  const candidateBlocks = attachProofsToPreviousTheorem(candidates ?? segmentRevisionCandidates(parsedNotes));
  const guidanceText = renderDocuments(guidanceDocuments);
  const notesText = renderDocuments(parsedNotes);
  const courseKnowledgeMap = buildCourseKnowledgeMap(guidanceText, notesText);
  const courseStructureMap = buildCourseStructureMap(parsedNotes, candidateBlocks, courseKnowledgeMap);
  const timestamp = new Date().toISOString();

  const scored = candidateBlocks.map((candidate) => {
    const item = createRevisionItemFromCandidate(candidate, guidanceText, timestamp);
    const score = scoreRevisionCandidate(candidate, item, guidanceText);
    return {
      candidate,
      score,
      item: applyScoreToItem(item, score, guidanceText),
    } satisfies ScoredCandidate;
  });

  const keptItems: RevisionItem[] = [];
  const rejectedItems: RejectedRevisionItem[] = [];
  const seenKept = new Map<string, RevisionItem>();
  const embeddedCandidates: ScoredCandidate[] = [];
  const embeddedItems: EmbeddedRevisionItem[] = [];

  for (const entry of scored) {
    const duplicateOf = seenKept.get(duplicateKey(entry.item));
    if (duplicateOf) {
      rejectedItems.push(toRejectedItem(entry, "duplicate", `Duplicate or near-duplicate of "${duplicateOf.cardFront}".`, "high"));
      continue;
    }

    if (entry.score.keepDecision === "keep" || entry.score.keepDecision === "needs_review") {
      keptItems.push(entry.item);
      seenKept.set(duplicateKey(entry.item), entry.item);
      continue;
    }

    if (entry.score.keepDecision === "embed_in_parent") {
      embeddedCandidates.push(entry);
      continue;
    }

    rejectedItems.push(toRejectedItem(entry, rejectionCategoryFor(entry), entry.score.reason, scoreConfidence(entry.score)));
  }

  for (const entry of embeddedCandidates) {
    const parent = findParentItem(entry.candidate, keptItems);
    const item = parent ? { ...entry.item, parentItemId: parent.id } : entry.item;
    if (parent) {
      parent.embeddedFormulas = Array.from(new Set([...(parent.embeddedFormulas ?? []), entry.candidate.statement ?? entry.candidate.rawText]));
      parent.updatedAt = timestamp;
    }
    embeddedItems.push({
      id: createId("embedded"),
      parentItemId: parent?.id ?? item.parentItemId ?? "",
      content: entry.candidate.statement ?? entry.candidate.rawText,
      reason: parent ? `${entry.score.reason} Embedded into "${parent.cardFront}".` : entry.score.reason,
      sourceLocation: entry.item.sourceLocation,
    });
  }

  const keptWithProofCards = addRequiredProofCards(keptItems, timestamp);
  const qualityGate = qualityGateRevisionItems(keptWithProofCards, guidanceDocuments);
  const gatedRejectedItems = [
    ...rejectedItems,
    ...qualityGate.rejectedItems.map((item) =>
      toRejectedItem(
        {
          candidate: {
            id: item.id,
            type: item.type,
            label: "Other",
            rawText: item.statement,
            sourceFile: item.sourceFile,
            startOffset: 0,
            endOffset: item.statement.length,
          } as CandidateRevisionBlock,
          item,
          score: item.relevanceScore ?? score(item.id, 1, 1, 1, 1, 1, "reject", item.curationReason ?? "Rejected by quality gate.", []),
        },
        "low_value",
        item.curationReason ?? "Rejected by quality gate.",
        "medium",
      ),
    ),
  ];
  const curationReport = buildCurationReport(candidateBlocks, qualityGate.keptItems, qualityGate.needsReviewItems, gatedRejectedItems, embeddedItems, courseStructureMap);

  return {
    keptItems: qualityGate.keptItems,
    needsReviewItems: qualityGate.needsReviewItems,
    rejectedItems: gatedRejectedItems,
    embeddedItems,
    courseStructureMap,
    courseKnowledgeMap,
    curationReport,
  };
}

export function qualityGateRevisionItems(items: RevisionItem[], guidanceDocuments: ParsedDocument[]): {
  keptItems: RevisionItem[];
  needsReviewItems: RevisionItem[];
  rejectedItems: RevisionItem[];
} {
  const guidanceText = guidanceDocuments.map((doc) => doc.fullText).join("\n\n").toLowerCase();
  const keptItems: RevisionItem[] = [];
  const needsReviewItems: RevisionItem[] = [];
  const rejectedItems: RevisionItem[] = [];

  for (const item of items) {
    const lower = `${item.title}\n${item.statement}\n${item.answer}`.toLowerCase();
    const latex = validateLatexQuality(item);
    const genericConcept = isGenericConceptName(item.conceptName || item.cardFront);
    const guidanceHit = Boolean(item.theoremNumber && guidanceText.includes(item.theoremNumber.toLowerCase())) || (item.conceptName ? guidanceText.includes(item.conceptName.toLowerCase()) : false);
    const standalone = item.standaloneValue ?? "medium";

    if (looksLikeBibliography(lower) || looksLikeParseNoise(lower) || /intermediate|hence|therefore/.test(lower) && item.type === "formula") {
      rejectedItems.push({ ...item, curationDecision: "reject", curationReason: "Rejected as low-value/background/parse-noise content." });
      continue;
    }

    if (genericConcept && !guidanceHit) {
      needsReviewItems.push({ ...item, curationStatus: "needs_review", curationDecision: "needs_review", cardPurpose: "needs_review", curationReason: "Generic concept name requires manual rename." });
      continue;
    }

    if (latex.score === "low") {
      needsReviewItems.push({ ...item, curationStatus: "needs_review", curationDecision: "needs_review", cardPurpose: "needs_review", curationReason: "Low LaTeX quality." });
      continue;
    }

    if (item.importance === "unknown") {
      if (standalone === "high") {
        keptItems.push({ ...item, curationDecision: "keep" });
      } else if (standalone === "medium") {
        needsReviewItems.push({ ...item, curationStatus: "needs_review", curationDecision: "needs_review", cardPurpose: "needs_review", curationReason: "Unknown guidance with medium standalone value." });
      } else {
        rejectedItems.push({ ...item, curationDecision: "reject", curationReason: "Unknown guidance with low standalone value." });
      }
      continue;
    }

    if (item.type === "formula" && standalone !== "high" && !guidanceHit) {
      needsReviewItems.push({ ...item, curationStatus: "needs_review", curationDecision: "needs_review", cardPurpose: "needs_review", curationReason: "Formula standalone value is unclear." });
      continue;
    }

    if (theoremLike(item.type) && item.importance !== "must_know" && !guidanceHit) {
      needsReviewItems.push({ ...item, curationStatus: "needs_review", curationDecision: "needs_review", cardPurpose: "needs_review", curationReason: "Theorem-like statement not clearly central." });
      continue;
    }

    keptItems.push({ ...item, curationStatus: "kept", curationDecision: "keep" });
  }

  return { keptItems, needsReviewItems, rejectedItems };
}

export function createRevisionItemFromCandidate(candidate: CandidateRevisionBlock, guidanceText: string, timestamp = new Date().toISOString()): RevisionItem {
  const statementWithPossibleTitle = clean(candidate.statement ?? stripLeadingLabel(candidate.rawText));
  const titleSplit = splitTitleFromStatement(statementWithPossibleTitle);
  const proofSplit = splitProofFromStatement(titleSplit.statement);
  const statement = clean(proofSplit.statement);
  const proof = clean(candidate.proof ?? proofSplit.proof ?? "") || undefined;
  const theoremNumber = candidate.number ?? extractNumber(candidate.title ?? "");
  const conceptName = extractConceptName(candidate, {
    type: candidate.type,
    title: candidate.title ?? "",
    theoremNumber,
    statement,
    titleTopic: titleSplit.title,
  });
  const title = titleFromLabel(candidate.type, theoremNumber, titleSplit.title ?? conceptName, statement);
  const proofRequired = theoremLike(candidate.type) ? classifyProofRequired(guidanceText, title, statement) : undefined;
  const cardPurpose = inferCardPurpose(candidate.type, title, statement, proofRequired);

  return {
    id: createId("card"),
    type: candidate.type,
    title,
    conceptName,
    displayTitle: title,
    cardFront: conceptName || title,
    taskPrompt: defaultTaskPrompt(candidate.type, cardPurpose, proofRequired),
    statement,
    statementLatex: convertCommonMathToLatex(statement),
    originalRawText: candidate.rawText,
    proof,
    proofLatex: proof ? convertCommonMathToLatex(proof) : undefined,
    proofRequired,
    sourceFile: candidate.sourceFile,
    sourceLocation: candidate.sourceLocation,
    pageNumber: candidate.pageNumber,
    section: candidate.section,
    theoremNumber,
    tags: inferTags(candidate.type, `${title} ${statement}`),
    importance: "unknown",
    cardPurpose,
    curationStatus: "kept",
    classificationConfidence: "medium",
    guidanceReason: "Awaiting curation against guidance.",
    extractionWarning: candidate.extractionWarning,
    questionPrompt: buildQuestionPrompt({ type: candidate.type, title, theoremNumber, statement, proofRequired }),
    answer: buildAnswer(candidate.type, statement),
    answerLatex: convertCommonMathToLatex(buildAnswer(candidate.type, statement)),
    standaloneValue: candidate.type === "formula" ? "low" : "medium",
    curationDecision: "needs_review",
    curationReason: "Awaiting final deck quality gate.",
    relevanceReason: "Awaiting curation score.",
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewCount: 0,
  };
}

export function scoreRevisionCandidate(candidate: CandidateRevisionBlock, item: RevisionItem, guidanceText: string): CandidateRelevanceScore {
  const text = `${item.title}\n${item.statement}\n${item.originalRawText ?? ""}`;
  const lower = text.toLowerCase();
  const guidance = guidanceText.toLowerCase();
  const evidence: string[] = [];

  if (looksLikeBibliography(text)) {
    return score(candidate.id, 0, 0, 0, 0, 1, "reject", "Bibliography, reading-list, citation, or publisher reference text.", evidence);
  }

  if (looksLikeParseNoise(text)) {
    return score(candidate.id, 0, 0, 0, 0, 1, "reject", "Parsing noise rather than usable examinable content.", evidence);
  }

  const guidanceSupport = guidanceSupportScore(item, guidance, evidence);
  const proofRequired = item.proofRequired === true || proofRequiredByGuidance(item, guidance);
  const explicitlyNotRequired = isExplicitlyNotRequired(item, guidance);
  const centrality = conceptualCentrality(item, lower, evidence);
  const standalone = standaloneValueScore(item, lower, guidanceSupport, centrality);
  const examRelevance = asScore(Math.max(guidanceSupport, centrality >= 4 ? 4 : centrality, item.importance === "must_know" ? 5 : 0));
  const genericConcept = isGenericConceptName(item.conceptName || item.cardFront);

  if (genericConcept && guidanceSupport < 4) {
    return score(candidate.id, examRelevance, standalone, centrality, guidanceSupport, 1, "needs_review", "Concept name is generic and should be manually resolved.", evidence);
  }

  if (explicitlyNotRequired && guidanceSupport <= 2) {
    return score(candidate.id, 1, standalone, centrality, guidanceSupport, 1, "reject", "Guidance indicates this material is not required.", evidence);
  }

  if (candidate.type === "proof") {
    if (proofRequired) return score(candidate.id, 5, 4, centrality, Math.max(guidanceSupport, 4) as 4 | 5, 1, "keep", "Proof is explicitly required by guidance.", evidence);
    return score(candidate.id, 1, 1, centrality, guidanceSupport, 1, "reject", "Proof or derivation step is not required by guidance.", evidence);
  }

  if (item.type === "formula") {
    if (isLowValueFormula(lower, guidanceSupport)) {
      return score(candidate.id, 1, 1, centrality, guidanceSupport, 1, "reject", "Formula is background, a density template, an unnamed CDF expression, or an intermediate derivation line.", evidence);
    }
    if (isStandaloneFormula(lower) || guidanceSupport >= 4) {
      return score(candidate.id, Math.max(examRelevance, 4) as 4 | 5, 4, Math.max(centrality, 4) as 4 | 5, guidanceSupport, 1, "keep", "Named, central, or explicitly supported formula with standalone flashcard value.", evidence);
    }
    return score(candidate.id, examRelevance, Math.min(standalone, 2) as 0 | 1 | 2, centrality, guidanceSupport, 1, "embed_in_parent", "Formula is useful only inside its parent definition, theorem, or proof.", evidence);
  }

  if (theoremLike(item.type)) {
    if (guidanceSupport >= 4 || centrality >= 4 || item.theoremNumber) {
      return score(candidate.id, Math.max(examRelevance, 4) as 4 | 5, Math.max(standalone, 3) as 3 | 4 | 5, centrality, guidanceSupport, 1, "keep", "Theorem-like statement has standalone revision value; formulas inside it should stay embedded.", evidence);
    }
    return score(candidate.id, examRelevance, standalone, centrality, guidanceSupport, 1, "needs_review", "Theorem-like statement may matter, but guidance support is uncertain.", evidence);
  }

  if (item.type === "definition" || item.type === "algorithm" || item.type === "property" || item.type === "assumption") {
    if (guidanceSupport >= 4 || centrality >= 4 || isDefinitionStatement(lower)) {
      return score(candidate.id, Math.max(examRelevance, 4) as 4 | 5, Math.max(standalone, 3) as 3 | 4 | 5, centrality, guidanceSupport, 1, "keep", "Definition or method has active-recall value.", evidence);
    }
  }

  if (item.type === "remark") {
    if (guidanceSupport >= 4 || isImportantRemark(lower)) {
      return score(candidate.id, examRelevance, 3, Math.max(centrality, 3) as 3 | 4 | 5, guidanceSupport, 1, guidanceSupport >= 4 ? "keep" : "needs_review", "Remark captures a conceptual distinction, condition, or exam trap.", evidence);
    }
    return score(candidate.id, 1, 1, centrality, guidanceSupport, 1, "reject", "Ordinary explanatory remark, not a useful standalone flashcard.", evidence);
  }

  if (item.type === "example") {
    if (guidanceSupport >= 4 || isMethodLike(lower)) {
      return score(candidate.id, examRelevance, 3, centrality, guidanceSupport, 1, "needs_review", "Example may be a recurring calculation pattern, but should be checked.", evidence);
    }
    return score(candidate.id, 1, 1, centrality, guidanceSupport, 1, "reject", "Background example is not clearly examinable.", evidence);
  }

  if (item.cardPurpose === "conceptual_distinction" && centrality >= 3) {
    return score(candidate.id, Math.max(examRelevance, 4) as 4 | 5, Math.max(standalone, 3) as 3 | 4 | 5, Math.max(centrality, 4) as 4 | 5, guidanceSupport, 1, "keep", "Conceptual distinction has active-recall value even though it is not explicitly labelled.", evidence);
  }

  if (centrality >= 4 && standalone >= 3) {
    return score(candidate.id, examRelevance, standalone, centrality, guidanceSupport, 1, "needs_review", "Conceptually central but not clearly required; send for manual review.", evidence);
  }

  return score(candidate.id, examRelevance, standalone, centrality, guidanceSupport, 1, standalone <= 2 && guidanceSupport <= 2 ? "reject" : "needs_review", standalone <= 2 && guidanceSupport <= 2 ? "Low standalone flashcard value and little guidance support." : "Borderline candidate needs manual review.", evidence);
}

function applyScoreToItem(item: RevisionItem, score: CandidateRelevanceScore, guidanceText: string): RevisionItem {
  const proofRequired = theoremLike(item.type) ? Boolean(item.proofRequired) : undefined;
  return {
    ...item,
    importance: importanceFromScore(score, item, guidanceText),
    curationStatus: score.keepDecision === "needs_review" ? "needs_review" : "kept",
    curationDecision: score.keepDecision === "keep" ? "keep" : score.keepDecision === "needs_review" ? "needs_review" : "reject",
    curationReason: score.reason,
    classificationConfidence: scoreConfidence(score),
    guidanceReason: score.evidence.length ? score.evidence.join(" ") : "No explicit guidance match found.",
    standaloneValue: score.standaloneFlashcardValue >= 4 ? "high" : score.standaloneFlashcardValue >= 3 ? "medium" : "low",
    latexQuality: score.latexQuality,
    relevanceReason: score.reason,
    relevanceScore: score,
    taskPrompt: defaultTaskPrompt(item.type, item.cardPurpose, proofRequired),
    questionPrompt: buildQuestionPrompt({ type: item.type, title: item.title, theoremNumber: item.theoremNumber, statement: item.statement, proofRequired }),
  };
}

function addRequiredProofCards(items: RevisionItem[], timestamp: string) {
  const output = [...items];
  for (const item of items) {
    if (!theoremLike(item.type) || !item.proof || !item.proofRequired || item.curationStatus === "needs_review") continue;
    const proofTitle = `Proof of ${item.displayTitle || item.title}`;
    output.push({
      ...item,
      id: createId("card"),
      type: "proof",
      title: proofTitle,
      displayTitle: proofTitle,
      conceptName: proofTitle,
      cardFront: `Proof of ${item.cardFront}`,
      taskPrompt: "Reproduce the proof.",
      cardPurpose: "proof_recall",
      parentItemId: item.id,
      statement: item.statement,
      statementLatex: item.statementLatex,
      answer: item.proof,
      answerLatex: item.proofLatex ?? convertCommonMathToLatex(item.proof),
      tags: Array.from(new Set([...item.tags, "proof"])),
      relevanceReason: "Created because guidance indicates the proof is required.",
      questionPrompt: `Prove ${item.displayTitle || item.title}.`,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }
  return output;
}

function buildCourseKnowledgeMap(guidanceText: string, notesText: string): CourseKnowledgeMap {
  const combined = `${guidanceText}\n${notesText}`.toLowerCase();
  const guidance = guidanceText.toLowerCase();
  const coreTopics: CourseTopic[] = centralTopicTerms
    .filter((topic) => combined.includes(topic))
    .map((topic) => ({
      name: capitaliseWords(topic),
      relatedItems: [],
      importance: guidance.includes(topic) ? "core" : "supporting",
      evidence: evidenceSentences(topic, guidanceText || notesText),
      likelyExamUse: likelyExamUse(topic),
    }));

  return {
    coreTopics,
    requiredSections: extractRequiredSections(guidanceText),
    formulaPolicy: {
      standaloneFormulaRule: "Only named, central, examinable formulas become standalone cards.",
      keepStandaloneWhen: [
        "The formula defines a named core object.",
        "Guidance explicitly mentions the formula or its section.",
        "The formula is directly needed for exam calculations.",
        "The formula is a standard result with a natural recall prompt.",
      ],
      embedOrRejectWhen: [
        "The formula is part of a theorem statement or definition.",
        "The formula is an intermediate proof or algebra line.",
        "The formula has no named concept or is background density/reference material.",
      ],
      guidanceEvidence: evidenceSentences("formula", guidanceText),
    },
    proofPolicy: {
      proofCardRule: "Create proof-recall cards only when guidance asks students to prove, derive, or show the result.",
      proofRequiredWhen: ["Guidance says prove, proof required, derive, or show that."],
      proofOptionalWhen: ["Guidance says statement only, proof not required, without proof, or formula given."],
      guidanceEvidence: evidenceSentences("proof", guidanceText),
    },
  };
}

function buildCourseStructureMap(
  parsedNotes: ParsedDocument[],
  candidates: CandidateRevisionBlock[],
  courseKnowledgeMap: CourseKnowledgeMap,
): CourseStructureMap {
  const sections: CourseSection[] = parsedNotes.flatMap((document) => {
    if (!document.sections?.length) {
      return [{
        sectionNumber: undefined,
        title: document.sourceFile,
        sourceFile: document.sourceFile,
        pageStart: document.pages?.[0]?.pageNumber,
        pageEnd: document.pages?.at(-1)?.pageNumber,
        summary: document.fullText.slice(0, 240).replace(/\s+/g, " ").trim(),
        likelyImportance: "unknown" as const,
      }];
    }

    return document.sections.map((section) => {
      const relatedTopic = courseKnowledgeMap.coreTopics.find((topic) => section.text.toLowerCase().includes(topic.name.toLowerCase()));
      return {
        sectionNumber: section.sectionNumber,
        title: section.sectionTitle,
        sourceFile: document.sourceFile,
        pageStart: pageNumberAtOffset(document.fullText, section.startOffset),
        pageEnd: pageNumberAtOffset(document.fullText, section.endOffset),
        summary: section.text.slice(0, 240).replace(/\s+/g, " ").trim(),
        likelyImportance: relatedTopic?.importance ?? "unknown",
      };
    });
  });

  const topics = courseKnowledgeMap.coreTopics.map((topic) => ({
    ...topic,
    relatedItems: candidates
      .filter((candidate) => candidate.rawText.toLowerCase().includes(topic.name.toLowerCase()))
      .map((candidate) => candidate.id),
  }));

  return {
    sections,
    topics,
    detectedItems: candidates,
  };
}

function extractRequiredSections(guidanceText: string) {
  const sentences = splitSentences(guidanceText);
  const sections = new Map<string, { sectionTitle?: string; evidence: string[]; requirement: ReturnType<typeof requirementFromSentence> }>();
  for (const sentence of sentences) {
    for (const match of sentence.matchAll(/\b(?:section|chapter)?\s*(\d+(?:\.\d+)*)\b/gi)) {
      const number = match[1];
      const existing = sections.get(number);
      const requirement = requirementFromSentence(sentence);
      sections.set(number, {
        sectionTitle: sentence.match(/\b\d+(?:\.\d+)*\s+([A-Z][A-Za-z ,&-]{3,60})/)?.[1],
        requirement: strongerRequirement(existing?.requirement, requirement),
        evidence: Array.from(new Set([...(existing?.evidence ?? []), sentence.trim()])),
      });
    }
  }
  return Array.from(sections, ([sectionNumber, value]) => ({ sectionNumber, ...value }));
}

function requirementFromSentence(sentence: string) {
  const lower = sentence.toLowerCase();
  if (/\bnot required|excluded|do not need\b/.test(lower)) return "not_required" as const;
  if (/\bproofs?\s+(?:are\s+)?not required|without proof|statement only|only (?:need to )?know the statement\b/.test(lower)) return "proof_not_required" as const;
  if (/\bprove|proof required|derive|show that\b/.test(lower)) return "proof_required" as const;
  if (/\bstatement|state\b/.test(lower)) return "statement_only" as const;
  if (/\bunderstand|interpret|explain\b/.test(lower)) return "understand_only" as const;
  if (/\bmust|required|examinable|memorise|memorize|learn|know\b/.test(lower)) return "must_know" as const;
  return "unknown" as const;
}

function strongerRequirement(current: ReturnType<typeof requirementFromSentence> | undefined, next: ReturnType<typeof requirementFromSentence>) {
  if (!current) return next;
  const order = ["unknown", "understand_only", "statement_only", "must_know", "proof_not_required", "proof_required", "not_required"];
  return order.indexOf(next) > order.indexOf(current) ? next : current;
}

function score(
  candidateId: string,
  examRelevance: number,
  standaloneFlashcardValue: number,
  conceptualCentrality: number,
  guidanceSupport: number,
  redundancyRisk: number,
  keepDecision: CandidateRelevanceScore["keepDecision"],
  reason: string,
  evidence: string[],
): CandidateRelevanceScore {
  const decision = keepDecision;
  const formulaImportance = keepDecision === "keep" && reason.toLowerCase().includes("formula") ? Math.max(examRelevance, conceptualCentrality) : 0;
  const proofRequirement = reason.toLowerCase().includes("proof is explicitly required") ? 5 : reason.toLowerCase().includes("proof") ? Math.min(guidanceSupport, 2) : 0;
  return {
    candidateId,
    examRelevance: asScore(examRelevance),
    standaloneFlashcardValue: asScore(standaloneFlashcardValue),
    conceptualCentrality: asScore(conceptualCentrality),
    guidanceSupport: asScore(guidanceSupport),
    formulaImportance: asScore(formulaImportance),
    proofRequirement: asScore(proofRequirement),
    parseQuality: "medium",
    latexQuality: "medium",
    decision,
    redundancyRisk: asScore(redundancyRisk),
    keepDecision,
    reason,
    evidence,
  };
}

function asScore(value: number): 0 | 1 | 2 | 3 | 4 | 5 {
  return Math.max(0, Math.min(5, Math.round(value))) as 0 | 1 | 2 | 3 | 4 | 5;
}

function guidanceSupportScore(item: RevisionItem, guidance: string, evidence: string[]) {
  if (!guidance.trim()) return 0;
  const number = item.theoremNumber ?? extractNumber(item.title);
  if (number && guidance.includes(number.toLowerCase())) {
    evidence.push(`Guidance references ${number}.`);
    return 5;
  }
  const concept = normalise(item.conceptName ?? item.cardFront);
  if (concept && guidance.includes(concept)) {
    evidence.push(`Guidance mentions ${item.conceptName ?? item.cardFront}.`);
    return /\bmust|required|examinable|derive|prove|state|use|know\b/.test(guidance) ? 4 : 3;
  }
  const keyword = centralTopicTerms.find((topic) => item.statement.toLowerCase().includes(topic) && guidance.includes(topic));
  if (keyword) {
    evidence.push(`Guidance mentions related topic ${keyword}.`);
    return /\bmust|required|examinable|derive|prove|state|use|know\b/.test(guidance) ? 4 : 3;
  }
  return 0;
}

function conceptualCentrality(item: RevisionItem, lower: string, evidence: string[]) {
  let value = 0;
  if (centralTopicTerms.some((topic) => lower.includes(topic))) value = Math.max(value, 4);
  if (centralFormulaTerms.some((topic) => lower.includes(topic))) value = Math.max(value, 4);
  if (item.type === "definition" && isDefinitionStatement(lower)) value = Math.max(value, 4);
  if (theoremLike(item.type) && item.theoremNumber) value = Math.max(value, 3);
  if (isMethodLike(lower)) value = Math.max(value, 4);
  if (value >= 4) evidence.push("Candidate matches a core course concept or method.");
  return asScore(value);
}

function standaloneValueScore(item: RevisionItem, lower: string, guidanceSupport: number, centrality: number) {
  if (item.statement.length < 20) return 1;
  if (item.statement.length > 1800 || wordCount(item.statement) > 220) return 1;
  if (item.type === "formula") return isStandaloneFormula(lower) || guidanceSupport >= 4 ? 4 : 2;
  if (item.type === "remark" || item.type === "example") return isImportantRemark(lower) || isMethodLike(lower) ? 3 : 1;
  if (item.type === "other") return centrality >= 4 ? 3 : 1;
  if (item.type === "proof") return guidanceSupport >= 4 ? 4 : 1;
  return centrality >= 4 || guidanceSupport >= 4 ? 4 : 3;
}

function importanceFromScore(score: CandidateRelevanceScore, item: RevisionItem, guidanceText: string): RevisionItem["importance"] {
  if (isExplicitlyNotRequired(item, guidanceText.toLowerCase())) return "not_required";
  if (score.guidanceSupport >= 4 || score.examRelevance >= 5) return "must_know";
  if (score.keepDecision === "needs_review" || score.examRelevance >= 3) return "partial";
  return "unknown";
}

function scoreConfidence(score: CandidateRelevanceScore): "high" | "medium" | "low" {
  if (score.keepDecision === "reject" && (score.examRelevance <= 1 || score.standaloneFlashcardValue <= 1)) return "high";
  if (score.guidanceSupport >= 4 || (score.examRelevance >= 4 && score.standaloneFlashcardValue >= 3)) return "high";
  if (score.keepDecision === "needs_review") return "low";
  return "medium";
}

function rejectionCategoryFor(entry: ScoredCandidate): RejectionCategory {
  if (looksLikeBibliography(entry.item.originalRawText ?? entry.item.statement)) return "bibliography_or_reference";
  if (looksLikeParseNoise(entry.item.originalRawText ?? entry.item.statement)) return "parse_noise";
  if (entry.item.type === "formula") return "formula_not_standalone";
  if (entry.item.type === "proof") return "intermediate_proof_step";
  if (entry.item.type === "remark" || entry.item.type === "example" || entry.item.type === "other") return "ordinary_explanatory_text";
  if (entry.item.statement.length > 1800 || wordCount(entry.item.statement) > 220) return "too_broad";
  return "low_value";
}

function toRejectedItem(entry: ScoredCandidate, rejectionCategory: RejectionCategory, rejectionReason: string, confidence: "high" | "medium" | "low"): RejectedRevisionItem {
  return {
    id: createId("rejected"),
    originalCandidateId: entry.candidate.id,
    originalItem: {
      ...entry.item,
      standaloneValue: "low",
      relevanceReason: rejectionReason,
      relevanceScore: entry.score,
    },
    title: entry.item.displayTitle || entry.item.title,
    type: entry.item.type,
    rawText: entry.candidate.rawText,
    rejectionCategory,
    rejectionReason,
    confidence,
    sourceLocation: entry.item.sourceLocation,
  };
}

function findParentItem(candidate: CandidateRevisionBlock, items: RevisionItem[]) {
  const parents = items.filter((item) =>
    item.sourceFile === candidate.sourceFile &&
    item.sourceLocation !== candidate.sourceLocation &&
    (item.type === "definition" || theoremLike(item.type)) &&
    (item.pageNumber === candidate.pageNumber || !item.pageNumber || !candidate.pageNumber),
  );
  return parents.at(-1);
}

function buildCurationReport(
  candidates: CandidateRevisionBlock[],
  keptItems: RevisionItem[],
  needsReviewItems: RevisionItem[],
  rejectedItems: RejectedRevisionItem[],
  embeddedItems: EmbeddedRevisionItem[],
  courseStructureMap: CourseStructureMap,
): CurationReport {
  const formulaCandidates = candidates.filter((candidate) => candidate.type === "formula").length;
  const formulaKeptCount = keptItems.filter((item) => item.type === "formula" && item.curationStatus !== "needs_review").length;
  const formulaRejectedCount = rejectedItems.filter((item) => item.type === "formula").length;
  return {
    totalCandidates: candidates.length,
    keptCount: keptItems.length,
    needsReviewCount: needsReviewItems.length,
    rejectedCount: rejectedItems.length,
    embeddedCount: embeddedItems.length,
    formulaCandidates,
    formulaKeptCount,
    formulaRejectedCount,
    mainTopics: courseStructureMap.topics.slice(0, 12).map((topic) => topic.name),
    weakParsingWarnings: courseStructureMap.sections
      .filter((section) => section.summary.length < 80)
      .map((section) => `Short or weakly parsed section: ${section.title}`),
    notes: [
      `${needsReviewItems.length} borderline item(s) were kept out of normal review for manual checking.`,
      `${embeddedItems.length} supporting formula/detail item(s) were embedded into parent cards.`,
      "Low-value formulas are rejected or embedded instead of becoming normal review cards.",
      "Proof cards are created only when guidance indicates proof or derivation is required.",
    ],
  };
}

function splitTitleFromStatement(statement: string) {
  const firstSentence = statement.match(/^([^.!?]{2,80})[.!?]\s+([\s\S]+)$/);
  if (!firstSentence) return { title: undefined, statement };
  const title = firstSentence[1].trim();
  const looksLikeStatement = /\b(is|are|has|if|then|defined|called|given|equals|denotes|consists)\b/i.test(title);
  const looksLikeBrokenMath = /[,(]$|[,()]|(?:^|\s)[A-Z][a-z]?\d\b|(?:^|\s)X_?\d\b/.test(title);
  const startsLikeStatement = /^(?:A|An|The|Let|Suppose|Assume)\b/i.test(title);
  if (title.split(/\s+/).length <= 8 && !looksLikeStatement && !looksLikeBrokenMath && !startsLikeStatement) {
    return { title, statement: firstSentence[2].trim() };
  }
  return { title: undefined, statement };
}

function titleFromLabel(type: RevisionItemType, number: string | undefined, explicitTitle: string | undefined, statement: string) {
  if (number && explicitTitle) return `${capitalise(type)} ${number}. ${capitalise(explicitTitle)}`;
  if (number) return `${capitalise(type)} ${number}`;
  const firstWords = statement.split(" ").slice(0, 6).join(" ");
  return `${capitalise(type)}: ${firstWords}${statement.split(" ").length > 6 ? "..." : ""}`;
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
  if (isMethodLike(lower)) return "calculation_template";
  return "definition_recall";
}

function defaultTaskPrompt(type: RevisionItemType, purpose: RevisionItem["cardPurpose"], proofRequired: boolean | undefined) {
  if (purpose === "conceptual_distinction") return "Explain the difference and implication relationship.";
  if (purpose === "calculation_template") return "Set up the calculation template.";
  if (purpose === "method_steps") return "Recall the method steps.";
  if (purpose === "application_condition") return "State when this applies.";
  if (purpose === "proof_recall" && type === "proof") return "Reproduce the proof.";
  if (type === "definition") return "Recall the exact definition.";
  if (type === "formula") return "Write down the formula and explain each term.";
  if (theoremLike(type)) return proofRequired ? "State the theorem and its conditions; know the proof separately." : "State the theorem and its conditions.";
  return "Recall the key statement.";
}

function classifyProofRequired(guidanceText: string, title: string, statement: string) {
  const guidance = guidanceText.toLowerCase();
  const haystack = `${title} ${statement}`.toLowerCase();
  if (!guidance.trim()) return undefined;
  if (/proofs?\s+(?:are\s+)?not required|proof\s+not required|without proof|only (?:know )?the statement/.test(guidance)) return false;
  if (/\b(prove|proof required|derive|show that)\b/.test(guidance)) {
    const number = extractNumber(title);
    if (!number || guidance.includes(number) || haystack.split(/\W+/).some((word) => word.length > 4 && guidance.includes(word))) return true;
  }
  return undefined;
}

function proofRequiredByGuidance(item: RevisionItem, guidance: string) {
  if (!guidance.trim()) return false;
  if (!/\b(prove|proof required|derive|show that)\b/.test(guidance)) return false;
  const number = item.theoremNumber ?? extractNumber(item.title);
  if (number && guidance.includes(number.toLowerCase())) return true;
  return normalise(item.conceptName ?? item.title).split(" ").some((word) => word.length > 4 && guidance.includes(word));
}

function isExplicitlyNotRequired(item: RevisionItem, guidance: string) {
  if (!guidance.trim()) return false;
  const number = item.theoremNumber ?? extractNumber(item.title);
  const relevant = number ? guidance.includes(number.toLowerCase()) : normalise(item.conceptName ?? item.title).split(" ").some((word) => word.length > 4 && guidance.includes(word));
  return relevant && /\bnot required|excluded|do not need|without proof|proofs? are not required\b/.test(guidance);
}

function isDefinitionStatement(lower: string) {
  return /\b(is|are|called|defined as|we say that|denotes|consists of|if and only if)\b/.test(lower);
}

function isStandaloneFormula(lower: string) {
  return centralFormulaTerms.some((term) => lower.includes(term)) ||
    /\bformula for\b/.test(lower) ||
    /\b(is|are|defined by|given by)\b/.test(lower) && /\b(semivariogram|variogram|kriging|blup|likelihood|intensity|covariance)\b/.test(lower);
}

function isLowValueFormula(lower: string, guidanceSupport: number) {
  if (guidanceSupport >= 4) return false;
  if (/\bnormal density|normal pdf|density of (?:a )?normal|gaussian density\b/.test(lower)) return true;
  if (/\bjoint cdf|cdf|distribution function\b/.test(lower) && !/\b(named|theorem|central)\b/.test(lower)) return true;
  if (/\bproof\b/.test(lower) && /[=<>]/.test(lower)) return true;
  return !isStandaloneFormula(lower) && countMathOperators(lower) >= 2 && wordCount(lower) < 60;
}

function isImportantRemark(lower: string) {
  return /\b(condition|equivalent|not necessarily|only if|if and only if|trap|important|note that|therefore|distinction|assumption|required|valid|applies)\b/.test(lower) &&
    /\b(random field|process|covariance|stationary|gaussian|kriging|intensity|distribution|theorem|definition|formula|variogram)\b/.test(lower);
}

function isMethodLike(lower: string) {
  return /\b(set up|calculate|compute|algorithm|procedure|steps|solve|estimate|predict|derive|use)\b/.test(lower) ||
    /\bkriging system|likelihood|estimator|predictor\b/.test(lower);
}

function looksLikeBibliography(text: string) {
  const lower = text.toLowerCase();
  let scoreValue = 0;
  if (/\[[A-Z]{1,4}\]\s+[A-Z][A-Za-z-]+,/.test(text)) scoreValue += 3;
  if (/\b(19|20)\d{2}\b/.test(text)) scoreValue += 1;
  if (/\b(CRC Press|Springer|Wiley|John Wiley|Cambridge|Oxford|Chapman|Hall|Routledge|Elsevier)\b/i.test(text)) scoreValue += 3;
  if (/\b(bibliography|references|reading list|textbook|publisher|press|edition|isbn|pages?\s+\d+)/i.test(text)) scoreValue += 2;
  if (/(?:[A-Z][A-Za-z-]+,\s+[A-Z][A-Za-z-]+(?:,| and)\s*){1,}/.test(text)) scoreValue += 2;
  if (/\bTheory of\b|\bStatistics for\b|\bIntroduction to\b|\bSpatial statistics\b/i.test(text)) scoreValue += 1;
  if (lower.includes("john wiley & sons")) scoreValue += 3;
  return scoreValue >= 3;
}

function looksLikeParseNoise(text: string) {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 20) return true;
  const symbolRatio = (text.match(/[^A-Za-z0-9\s.,;:()[\]{}_^=+\-*/\\]/g)?.length ?? 0) / Math.max(text.length, 1);
  return symbolRatio > 0.35;
}

function duplicateKey(item: RevisionItem) {
  return `${item.type}|${normalise(item.theoremNumber || item.cardFront || item.title)}|${normalise(item.statement).slice(0, 180)}`;
}

function buildAnswer(type: RevisionItemType, statement: string) {
  if (type === "formula") return `${statement}\n\nExplain the notation and conditions under which the formula applies.`;
  return statement;
}

function inferTags(type: RevisionItemType, text: string) {
  const tags = new Set<string>([type]);
  for (const keyword of ["stationarity", "covariance", "variogram", "semivariogram", "kriging", "blup", "proof", "formula", "theorem", "algorithm", "poisson", "gaussian"]) {
    if (text.toLowerCase().includes(keyword)) tags.add(keyword);
  }
  return Array.from(tags);
}

function likelyExamUse(topic: string): CourseTopic["likelyExamUse"] {
  if (/\bkriging|likelihood|intensity\b/.test(topic)) return "calculation";
  if (/\bsemivariogram|covariance\b/.test(topic)) return "calculation";
  if (/\bstationarity|isotropy\b/.test(topic)) return "conceptual_explanation";
  return "definition_recall";
}

function evidenceSentences(needle: string, source: string) {
  if (!source.trim()) return [];
  return splitSentences(source).filter((sentence) => sentence.toLowerCase().includes(needle.toLowerCase())).slice(0, 5);
}

function renderDocuments(documents: ParsedDocument[]) {
  return documents.map((document) => document.fullText).join("\n\n");
}

function splitSentences(value: string) {
  return value.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

function pageNumberAtOffset(text: string, offset: number) {
  let pageNumber: number | undefined;
  for (const match of text.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((match.index ?? 0) > offset) break;
    pageNumber = Number(match[1]);
  }
  return pageNumber;
}

function countMathOperators(value: string) {
  return value.split("").filter((char) => "=+-*/<>".includes(char)).length;
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function normalise(value = "") {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function clean(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function capitaliseWords(value: string) {
  return value.split(/\s+/).map(capitalise).join(" ");
}
