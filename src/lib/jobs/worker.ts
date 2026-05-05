import { runLlmExtractionPipeline } from "@/lib/llm/pipeline";
import { parseStudyFile } from "@/lib/parsers";
import { pageRecordsFromDocument } from "@/lib/extraction/page-records";
import { splitPagesIntoChunks } from "@/lib/extraction/chunking";
import { lightweightCandidateSummary, parsedDocumentFromChunk } from "@/lib/extraction/candidates";
import { mergeChunkPipelineResults } from "@/lib/extraction/merge-pack";
import { buildDebugJson } from "@/lib/extraction/debug-json";
import { JOB_PATHS, readBlobAsFile, readJsonBlob, writeJsonBlob } from "@/lib/jobs/blob-store";
import { failJob, patchJobStatus, readJobManifest, readJobStatus, writeJobManifest } from "@/lib/jobs/status-store";
import type { ChunkRecord, ExtractionJobFile, ExtractionJobManifest, ExtractionJobStatus, ExtractionMode, StructuredJobError } from "@/lib/jobs/types";
import type { ParsedDocument } from "@/lib/types";

export const SMALL_DEV_FILE_LIMIT = 18 * 1024 * 1024;

type PipelineResult = Awaited<ReturnType<typeof runLlmExtractionPipeline>>;

export async function runExtractionJob(jobId: string) {
  const existingStatus = await readJobStatus(jobId);
  if (existingStatus?.status === "cancelled") return existingStatus;

  const manifest = await readJobManifest(jobId);
  if (!manifest) {
    throw new Error(`Missing job manifest for ${jobId}.`);
  }

  try {
    await patchJobStatus(jobId, { status: "processing", currentStage: "processing", progress: 4, manifestPath: JOB_PATHS.manifest(jobId) });
    const files = manifest.files?.length ? manifest.files : [manifest.file];
    const parsedDocuments = await parseSourceFiles(jobId, files);

    await ensureNotCancelled(jobId);
    await patchJobStatus(jobId, { status: "chunking", currentStage: "chunking", progress: 22 });
    const chunks = parsedDocuments.flatMap((doc) => splitPagesIntoChunks(pageRecordsFromDocument(doc), manifest.mode));
    const nextManifest = withChunks(manifest, chunks);
    await writeJobManifest(nextManifest);

    const results: PipelineResult[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      await ensureNotCancelled(jobId);
      const chunk = chunks[index]!;
      const currentChunk = nextManifest.chunks[index]!;
      const baseProgress = 25 + Math.round((index / Math.max(1, chunks.length)) * 58);

      if (currentChunk.status === "completed" && currentChunk.candidatesPath) {
        const cached = await readJsonBlob<PipelineResult>(currentChunk.candidatesPath);
        if (cached) {
          results.push(cached);
          continue;
        }
      }

      await patchJobStatus(jobId, {
        status: "calling_openai",
        currentStage: "calling_openai",
        currentChunk: chunk.chunkId,
        totalChunks: chunks.length,
        progress: baseProgress,
      });
      nextManifest.chunks[index] = { ...currentChunk, status: "processing" };
      await writeJobManifest(nextManifest);

      const chunkTextPath = JOB_PATHS.pageChunk(jobId, chunk.pageStart, chunk.pageEnd);
      await writeJsonBlob(chunkTextPath, chunk);

      const pipelineResult = await runChunkExtraction(chunk, manifest.mode);
      const candidatesPath = JOB_PATHS.candidates(jobId, chunk.chunkId);
      await writeJsonBlob(candidatesPath, {
        ...pipelineResult,
        lightweightCandidates: lightweightCandidateSummary(chunk),
      });
      results.push(pipelineResult);

      nextManifest.chunks[index] = {
        ...currentChunk,
        status: "completed",
        textPath: chunkTextPath,
        candidatesPath,
      };
      await writeJobManifest(nextManifest);
      await patchJobStatus(jobId, {
        currentChunk: chunk.chunkId,
        totalChunks: chunks.length,
        progress: Math.min(84, baseProgress + 4),
      });
    }

    await ensureNotCancelled(jobId);
    await patchJobStatus(jobId, { status: "merging_chunks", currentStage: "merging_chunks", progress: 86 });
    const result = mergeChunkPipelineResults({
      jobId,
      mode: manifest.mode,
      sourceFiles: parsedDocuments.map((doc, index) => ({
        id: `${jobId}-${index}`,
        name: doc.sourceFile,
        role: doc.role ?? "other",
        parsedText: doc.fullText,
        pages: doc.pages?.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
      })),
      chunkResults: results,
    });

    await patchJobStatus(jobId, { status: "building_pack", currentStage: "building_pack", progress: 92 });
    const resultBlob = await writeJsonBlob(JOB_PATHS.examPack(jobId), result);
    const debugBlob = await writeJsonBlob(JOB_PATHS.debug(jobId), buildDebugJson({ manifest: nextManifest, chunks, result }));
    const completed = await patchJobStatus(jobId, {
      status: "completed",
      currentStage: "completed",
      progress: 100,
      currentChunk: undefined,
      resultPath: resultBlob.pathname,
      resultUrl: resultBlob.url,
      debugPath: debugBlob.pathname,
      debugUrl: debugBlob.url,
    });
    return completed;
  } catch (error) {
    const structured = structuredError(error);
    await failJob(jobId, structured, structured.stage);
    return readJobStatus(jobId);
  }
}

async function parseSourceFiles(jobId: string, files: ExtractionJobFile[]) {
  const parsed: ParsedDocument[] = [];
  let completed = 0;
  for (const file of files) {
    await ensureNotCancelled(jobId);
    await patchJobStatus(jobId, {
      status: "extracting_text",
      currentStage: "extracting_text",
      progress: 8 + Math.round((completed / Math.max(1, files.length)) * 12),
    });
    const source = await readBlobAsFile({ url: file.url, filename: file.filename, contentType: file.contentType });
    const document = await parseStudyFile(source, { runOcr: false });
    if (!document.fullText.trim()) {
      throw Object.assign(new Error(`No readable text was extracted from ${file.filename}.`), {
        errorCode: "TEXT_EXTRACTION_FAILED",
        stage: "extracting_text",
      });
    }
    parsed.push({ ...document, role: file.role });
    completed += 1;
  }
  return parsed;
}

function withChunks(manifest: ExtractionJobManifest, chunks: ChunkRecord[]): ExtractionJobManifest {
  const existingById = new Map(manifest.chunks.map((chunk) => [chunk.chunkId, chunk]));
  return {
    ...manifest,
    stages: [...new Set<ExtractionJobStatus>([...manifest.stages, "extracting_text", "chunking", "calling_openai", "merging_chunks", "building_pack"])],
    chunks: chunks.map((chunk) => existingById.get(chunk.chunkId) ?? {
      chunkId: chunk.chunkId,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      status: "pending",
    }),
    updatedAt: new Date().toISOString(),
  };
}

async function runChunkExtraction(chunk: ChunkRecord, mode: ExtractionMode): Promise<PipelineResult> {
  const document = parsedDocumentFromChunk(chunk);
  const settings = {
    openaiApiKey: process.env.OPENAI_API_KEY?.trim(),
    mode: "openai_api" as const,
    verifyExtraction: mode === "deep",
    reasoningEffort: mode === "fast" ? "low" as const : "medium" as const,
  };
  if (!settings.openaiApiKey) {
    throw Object.assign(new Error("Missing OPENAI_API_KEY on the server."), {
      errorCode: "OPENAI_TIMEOUT",
      stage: "calling_openai",
      chunkId: chunk.chunkId,
    });
  }
  return runLlmExtractionPipeline({
    notesDocuments: chunk.role === "lecture_notes" || chunk.role === "formula_sheet" || chunk.role === "other" ? [document] : [],
    guidanceDocuments: chunk.role === "exam_guidance" ? [document] : [],
    pastPaperDocuments: chunk.role === "past_paper" ? [document] : [],
    problemSheetDocuments: chunk.role === "problem_sheet" ? [document] : [],
    solutionDocuments: chunk.role === "solution_sheet" || chunk.role === "mark_scheme" ? [document] : [],
    settings,
  });
}

async function ensureNotCancelled(jobId: string) {
  const status = await readJobStatus(jobId);
  if (status?.status === "cancelled") {
    throw Object.assign(new Error("Job was cancelled."), {
      errorCode: "JOB_CANCELLED",
      stage: "cancelled",
    });
  }
}

function structuredError(error: unknown): StructuredJobError {
  const code = typeof error === "object" && error && "errorCode" in error ? String((error as { errorCode?: string }).errorCode) : "";
  const stage = typeof error === "object" && error && "stage" in error ? String((error as { stage?: string }).stage) : undefined;
  const chunkId = typeof error === "object" && error && "chunkId" in error ? String((error as { chunkId?: string }).chunkId) : undefined;
  const message = error instanceof Error ? error.message : "Extraction failed.";
  const lower = message.toLowerCase();
  const errorCode: StructuredJobError["errorCode"] =
    code === "JOB_CANCELLED" ? "JOB_CANCELLED"
    : code === "TEXT_EXTRACTION_FAILED" ? "TEXT_EXTRACTION_FAILED"
    : lower.includes("rate") || lower.includes("quota") ? "OPENAI_RATE_LIMIT"
    : lower.includes("timeout") || lower.includes("timed out") ? "OPENAI_TIMEOUT"
    : stage === "merging_chunks" ? "MERGE_FAILED"
    : chunkId ? "CHUNK_FAILED"
    : "PDF_PARSE_FAILED";
  return {
    errorCode,
    message,
    stage: stage as StructuredJobError["stage"],
    chunkId,
    retryable: errorCode !== "JOB_CANCELLED",
    debugHint: "Already completed chunks stay in Blob; rerun the worker to resume from the last checkpoint.",
  };
}
