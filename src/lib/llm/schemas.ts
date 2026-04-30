export const revisionItemsResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          type: {
            type: "string",
            enum: ["definition", "theorem", "lemma", "proposition", "corollary", "formula", "proof", "algorithm", "example", "remark", "assumption", "property", "other"],
          },
          title: { type: "string" },
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
          relevanceReason: { type: "string" },
          deletedAt: { type: "string" },
          isDeleted: { type: "boolean" },
          createdAt: { type: "string" },
          updatedAt: { type: "string" },
        },
        required: ["id", "type", "title", "statement", "sourceFile", "tags", "importance", "questionPrompt", "answer", "createdAt", "updatedAt"],
      },
    },
  },
  required: ["items"],
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
