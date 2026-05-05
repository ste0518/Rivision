import type { ChunkRecord, ExamPackJobResult, ExtractionJobManifest } from "@/lib/jobs/types";

export function buildDebugJson(input: {
  manifest: ExtractionJobManifest;
  chunks: ChunkRecord[];
  result?: ExamPackJobResult;
  warnings?: string[];
}) {
  return {
    generatedAt: new Date().toISOString(),
    jobId: input.manifest.jobId,
    mode: input.manifest.mode,
    file: input.manifest.file,
    files: input.manifest.files,
    stages: input.manifest.stages,
    chunks: input.manifest.chunks,
    chunkStats: input.chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      pages: [chunk.pageStart, chunk.pageEnd],
      chars: chunk.text.length,
      estimatedTokens: chunk.estimatedTokens,
      headings: chunk.headings,
    })),
    resultCounts: input.result ? {
      items: input.result.extraction.items.length,
      needsReviewItems: input.result.extraction.needsReviewItems.length,
      rejectedItems: input.result.extraction.rejectedItems.length,
      definitions: input.result.pack.definitions.length,
      formulas: input.result.pack.formulas.length,
      proofs: input.result.pack.proofs.length,
      methods: input.result.pack.methods.length,
    } : undefined,
    warnings: input.warnings ?? [],
  };
}

