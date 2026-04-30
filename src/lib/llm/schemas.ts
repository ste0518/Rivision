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
            enum: ["definition", "theorem", "lemma", "proposition", "corollary", "formula", "proof", "algorithm", "example", "remark", "other"],
          },
          title: { type: "string" },
          statement: { type: "string" },
          proof: { type: "string" },
          proofRequired: { type: "boolean" },
          sourceFile: { type: "string" },
          sourceLocation: { type: "string" },
          section: { type: "string" },
          theoremNumber: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          importance: { type: "string", enum: ["must_know", "partial", "not_required", "unknown"] },
          guidanceReason: { type: "string" },
          uncertaintyNote: { type: "string" },
          questionPrompt: { type: "string" },
          answer: { type: "string" },
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
            enum: ["definition", "theorem", "lemma", "proposition", "corollary", "formula", "proof", "algorithm", "example", "remark", "other"],
          },
          sourceLocation: { type: "string" },
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
    overallCompleteness: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string" },
  },
  required: ["missingCandidates", "suspiciousItems", "overallCompleteness", "notes"],
} as const;
