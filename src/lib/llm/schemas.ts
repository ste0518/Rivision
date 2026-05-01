const revisionItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    type: {
      type: "string",
      enum: ["definition", "theorem", "lemma", "proposition", "corollary", "formula", "proof", "algorithm", "example", "remark", "assumption", "property", "other"],
    },
    title: { type: "string" },
    conceptName: { type: "string" },
    displayTitle: { type: "string" },
    cardFront: { type: "string" },
    taskPrompt: { type: "string" },
    cardPurpose: {
      type: "string",
      enum: ["definition_recall", "theorem_statement", "proof_recall", "formula_recall", "method_steps", "conceptual_distinction", "application_condition", "calculation_template", "background_context", "needs_review"],
    },
    curationStatus: { type: "string", enum: ["kept", "needs_review"] },
    statement: { type: "string" },
    statementLatex: { type: "string" },
    originalRawText: { type: "string" },
    proof: { type: "string" },
    proofLatex: { type: "string" },
    proofRequired: { type: "boolean" },
    sourceFile: { type: "string" },
    sourceLocation: { type: "string" },
    pageNumber: { type: "number" },
    section: { type: "string" },
    theoremNumber: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
    importance: { type: "string", enum: ["must_know", "partial", "not_required", "unknown"] },
    classificationConfidence: { type: "string", enum: ["high", "medium", "low"] },
    guidanceReason: { type: "string" },
    guidanceEvidence: { type: "array", items: { type: "string" } },
    uncertaintyNote: { type: "string" },
    extractionWarning: { type: "string" },
    questionPrompt: { type: "string" },
    answer: { type: "string" },
    answerLatex: { type: "string" },
    standaloneValue: { type: "string", enum: ["high", "medium", "low"] },
    curationDecision: { type: "string", enum: ["keep", "needs_review", "reject", "embed_in_parent"] },
    curationReason: { type: "string" },
    parentItemId: { type: "string" },
    embeddedFormulas: { type: "array", items: { type: "string" } },
    latexQuality: { type: "string", enum: ["high", "medium", "low"] },
    relevanceReason: { type: "string" },
    deletedAt: { type: "string" },
    isDeleted: { type: "boolean" },
    createdAt: { type: "string" },
    updatedAt: { type: "string" },
  },
  required: ["id", "type", "title", "cardFront", "cardPurpose", "statement", "sourceFile", "tags", "importance", "questionPrompt", "answer", "createdAt", "updatedAt"],
} as const;

export const revisionItemsResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: revisionItemSchema,
    },
  },
  required: ["items"],
} as const;

const rejectedRevisionItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    originalCandidateId: { type: "string" },
    originalItem: revisionItemSchema,
    title: { type: "string" },
    type: {
      type: "string",
      enum: ["definition", "theorem", "lemma", "proposition", "corollary", "formula", "proof", "algorithm", "example", "remark", "assumption", "property", "other"],
    },
    rawText: { type: "string" },
    rejectionCategory: {
      type: "string",
      enum: ["bibliography_or_reference", "ordinary_explanatory_text", "formula_not_standalone", "intermediate_proof_step", "duplicate", "too_broad", "not_examinable", "background_only", "low_value", "parse_noise"],
    },
    rejectionReason: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    sourceLocation: { type: "string" },
  },
  required: ["id", "title", "type", "rejectionCategory", "rejectionReason", "confidence"],
} as const;

const embeddedRevisionItemSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    parentItemId: { type: "string" },
    content: { type: "string" },
    reason: { type: "string" },
    sourceLocation: { type: "string" },
  },
  required: ["id", "parentItemId", "content", "reason"],
} as const;

const revisionCandidateSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "string" },
    label: {
      type: "string",
      enum: ["Definition", "Theorem", "Lemma", "Proposition", "Corollary", "Remark", "Example", "Proof", "Formula", "Assumption", "Property", "Algorithm", "Other"],
    },
    number: { type: "string" },
    title: { type: "string" },
    rawText: { type: "string" },
    statement: { type: "string" },
    proof: { type: "string" },
    sourceFile: { type: "string" },
    pageNumber: { type: "number" },
    sourceLocation: { type: "string" },
    startOffset: { type: "number" },
    endOffset: { type: "number" },
    extractionWarning: { type: "string" },
    section: { type: "string" },
  },
  required: ["id", "label", "rawText", "sourceFile", "startOffset", "endOffset"],
} as const;

const courseTopicSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    section: { type: "string" },
    relatedItems: { type: "array", items: { type: "string" } },
    importance: { type: "string", enum: ["core", "supporting", "background", "unknown"] },
    evidence: { type: "array", items: { type: "string" } },
    likelyExamUse: {
      type: "string",
      enum: ["definition_recall", "theorem_statement", "proof", "calculation", "derivation", "conceptual_explanation", "not_likely"],
    },
  },
  required: ["name", "relatedItems", "importance", "evidence", "likelyExamUse"],
} as const;

const courseStructureMapSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sectionNumber: { type: "string" },
          title: { type: "string" },
          sourceFile: { type: "string" },
          pageStart: { type: "number" },
          pageEnd: { type: "number" },
          summary: { type: "string" },
          likelyImportance: { type: "string", enum: ["core", "supporting", "background", "unknown"] },
        },
        required: ["title", "sourceFile", "summary", "likelyImportance"],
      },
    },
    topics: { type: "array", items: courseTopicSchema },
    detectedItems: { type: "array", items: revisionCandidateSchema },
  },
  required: ["sections", "topics", "detectedItems"],
} as const;

export const curatedDeckResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    keptItems: { type: "array", items: revisionItemSchema },
    needsReviewItems: { type: "array", items: revisionItemSchema },
    rejectedItems: { type: "array", items: rejectedRevisionItemSchema },
    embeddedItems: { type: "array", items: embeddedRevisionItemSchema },
    courseStructureMap: courseStructureMapSchema,
    courseKnowledgeMap: {
      type: "object",
      additionalProperties: false,
      properties: {
        coreTopics: {
          type: "array",
          items: courseTopicSchema,
        },
        requiredSections: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              sectionNumber: { type: "string" },
              sectionTitle: { type: "string" },
              requirement: {
                type: "string",
                enum: ["must_know", "statement_only", "proof_required", "proof_not_required", "understand_only", "not_required", "unknown"],
              },
              evidence: { type: "array", items: { type: "string" } },
            },
            required: ["requirement", "evidence"],
          },
        },
        formulaPolicy: {
          type: "object",
          additionalProperties: false,
          properties: {
            standaloneFormulaRule: { type: "string" },
            keepStandaloneWhen: { type: "array", items: { type: "string" } },
            embedOrRejectWhen: { type: "array", items: { type: "string" } },
            guidanceEvidence: { type: "array", items: { type: "string" } },
          },
          required: ["standaloneFormulaRule", "keepStandaloneWhen", "embedOrRejectWhen", "guidanceEvidence"],
        },
        proofPolicy: {
          type: "object",
          additionalProperties: false,
          properties: {
            proofCardRule: { type: "string" },
            proofRequiredWhen: { type: "array", items: { type: "string" } },
            proofOptionalWhen: { type: "array", items: { type: "string" } },
            guidanceEvidence: { type: "array", items: { type: "string" } },
          },
          required: ["proofCardRule", "proofRequiredWhen", "proofOptionalWhen", "guidanceEvidence"],
        },
      },
      required: ["coreTopics", "requiredSections", "formulaPolicy", "proofPolicy"],
    },
    curationReport: {
      type: "object",
      additionalProperties: false,
      properties: {
        totalCandidates: { type: "number" },
        keptCount: { type: "number" },
        needsReviewCount: { type: "number" },
        rejectedCount: { type: "number" },
        embeddedCount: { type: "number" },
        formulaCandidates: { type: "number" },
        formulaKeptCount: { type: "number" },
        formulaRejectedCount: { type: "number" },
        mainTopics: { type: "array", items: { type: "string" } },
        weakParsingWarnings: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["totalCandidates", "keptCount", "needsReviewCount", "rejectedCount", "embeddedCount", "formulaCandidates", "formulaKeptCount", "formulaRejectedCount", "mainTopics", "weakParsingWarnings", "notes"],
    },
  },
  required: ["keptItems", "needsReviewItems", "rejectedItems", "embeddedItems", "courseStructureMap", "courseKnowledgeMap", "curationReport"],
} as const;

export const verificationReportSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    missingCandidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          type: {
            type: "string",
            enum: ["definition", "theorem", "lemma", "proposition", "corollary", "formula", "proof", "algorithm", "example", "remark", "assumption", "property", "other"],
          },
          sourceLocation: { type: "string" },
          pageNumber: { type: "number" },
          reason: { type: "string" },
        },
        required: ["title", "type", "reason"],
      },
    },
    suspiciousItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          itemId: { type: "string" },
          issue: { type: "string" },
        },
        required: ["itemId", "issue"],
      },
    },
    guidanceAmbiguities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          guidanceText: { type: "string" },
          affectedSectionsOrTopics: { type: "array", items: { type: "string" } },
          interpretation: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["guidanceText", "affectedSectionsOrTopics", "interpretation", "confidence"],
      },
    },
    overallCompleteness: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
  required: ["missingCandidates", "suspiciousItems", "guidanceAmbiguities", "overallCompleteness", "notes"],
} as const;
