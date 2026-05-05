import type { ChunkRecord, ExtractionMode } from "@/lib/jobs/types";
import type { PageRecord } from "@/lib/extraction/page-records";

export type ChunkingConfig = {
  maxPagesPerChunk: number;
  maxCharsPerChunk: number;
  maxOpenAiInputChars: number;
};

export function chunkingConfigForMode(mode: ExtractionMode): ChunkingConfig {
  const maxPagesPerChunk = Number(process.env.MAX_PAGES_PER_CHUNK ?? (mode === "deep" ? 5 : mode === "standard" ? 8 : 12));
  const maxCharsPerChunk = Number(process.env.MAX_CHARS_PER_CHUNK ?? (mode === "deep" ? 22000 : mode === "standard" ? 30000 : 42000));
  const maxOpenAiInputChars = Number(process.env.MAX_OPENAI_INPUT_CHARS ?? (mode === "deep" ? 20000 : 25000));
  return { maxPagesPerChunk, maxCharsPerChunk, maxOpenAiInputChars };
}

export function splitPagesIntoChunks(pages: PageRecord[], mode: ExtractionMode, config = chunkingConfigForMode(mode)): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
  let current: PageRecord[] = [];
  let currentChars = 0;

  for (const page of pages) {
    const wouldOverflowPages = current.length >= config.maxPagesPerChunk;
    const wouldOverflowChars = current.length > 0 && currentChars + page.text.length > config.maxCharsPerChunk;
    const startsNewSection = current.length > 0 && page.headings.length > 0 && currentChars > config.maxOpenAiInputChars * 0.55;
    if (wouldOverflowPages || wouldOverflowChars || startsNewSection) {
      chunks.push(renderChunk(current, chunks.length, config));
      current = [];
      currentChars = 0;
    }
    current.push(page);
    currentChars += page.text.length;
  }

  if (current.length) chunks.push(renderChunk(current, chunks.length, config));
  return chunks;
}

function renderChunk(pages: PageRecord[], index: number, config: ChunkingConfig): ChunkRecord {
  const first = pages[0]!;
  const last = pages[pages.length - 1]!;
  const text = pages
    .map((page) => `Page ${page.pageNumber}\n${page.text}`)
    .join("\n\n")
    .slice(0, config.maxOpenAiInputChars);
  return {
    chunkId: `chunk-${String(index + 1).padStart(3, "0")}-p${first.pageNumber}-${last.pageNumber}`,
    pageStart: first.pageNumber,
    pageEnd: last.pageNumber,
    text,
    headings: [...new Set(pages.flatMap((page) => page.headings))].slice(0, 20),
    sourceFile: first.sourceFile,
    role: first.role,
    estimatedTokens: estimateTokens(text),
  };
}

export function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}
