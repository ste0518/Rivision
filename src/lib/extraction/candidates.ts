import type { ChunkRecord } from "@/lib/jobs/types";
import type { ParsedDocument } from "@/lib/types";

export function parsedDocumentFromChunk(chunk: ChunkRecord): ParsedDocument {
  return {
    sourceFile: `${chunk.sourceFile} (${chunk.chunkId})`,
    fileType: "pdf",
    role: chunk.role,
    fullText: chunk.text,
    pages: [{
      pageNumber: chunk.pageStart,
      text: chunk.text,
      charCount: chunk.text.length,
      textQuality: chunk.text.length > 500 ? "high" : "medium",
    }],
    sections: chunk.headings.map((heading, index) => ({
      sectionTitle: heading,
      startOffset: 0,
      endOffset: chunk.text.length,
      text: index === 0 ? chunk.text : "",
    })),
    diagnostics: {
      success: Boolean(chunk.text.trim()),
      charCount: chunk.text.length,
      pageCount: Math.max(1, chunk.pageEnd - chunk.pageStart + 1),
      warnings: [],
      errors: [],
      extractionQuality: chunk.text.length > 500 ? "high" : "medium",
    },
  };
}

export function lightweightCandidateSummary(chunk: ChunkRecord) {
  const lines = chunk.text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const importantLines = lines
    .filter((line) => /\b(definition|theorem|proposition|lemma|proof|formula|algorithm|example|question|derive|show that)\b/i.test(line) || /\\[a-zA-Z]+|[∑∫√∞≤≥]/.test(line))
    .slice(0, 80);
  return {
    chunkId: chunk.chunkId,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
    headings: chunk.headings,
    importantLines,
  };
}
