import { runLlmExtractionPipeline } from "@/lib/llm/pipeline";
import { parseStudyFile } from "@/lib/parsers";
import { pageRecordsFromDocument } from "@/lib/extraction/page-records";
import { splitPagesIntoChunks } from "@/lib/extraction/chunking";
import { lightweightCandidateSummary, parsedDocumentFromChunk } from "@/lib/extraction/candidates";
import { mergeChunkPipelineResults } from "@/lib/extraction/merge-pack";
import { buildDebugJson } from "@/lib/extraction/debug-json";
import { JOB_PATHS, readBlobAsFile, readJsonBlob, writeJsonBlob } from "@/lib/jobs/blob-store";
import { failJob, findQueuedJobIds, patchJobStatus, readJobManifest, readJobStatus, releaseJobLease, tryAcquireJobLease, writeJobManifest } from "@/lib/jobs/status-store";
import type { ChunkRecord, ExamPackJobResult, ExtractionJobFile, ExtractionJobManifest, ExtractionJobStatus, ExtractionJobStepOptions, ExtractionJobStepResult, ExtractionMode, ProcessJobsResult, StructuredJobError } from "@/lib/jobs/types";
import type { ParsedDocument } from "@/lib/types";

export const SMALL_DEV_FILE_LIMIT = 18 * 1024 * 1024;

type PipelineResult = Awaited<ReturnType<typeof runLlmExtractionPipeline>>;

export async function runExtractionJob(jobId: string) {
  const existingStatus = await readJobStatus(jobId);
  if (!existingStatus) return null;
  if (existingStatus.status !== "queued" && existingStatus.status !== "failed") return existingStatus;
  const owner = `full-${crypto.randomUUID()}`;
  const lease = await tryAcquireJobLease(jobId, owner);
  if (!lease.acquired && existingStatus.status !== "failed") return existingStatus;

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
  } finally {
    await releaseJobLease(jobId, owner);
  }
}

export async function processExtractionJobs(input: { jobId?: string; maxJobs?: number }): Promise<ProcessJobsResult> {
  const maxJobs = Math.max(1, Math.min(5, Number(input.maxJobs ?? 1) || 1));
  const jobIds = input.jobId ? [input.jobId] : await findQueuedJobIds(maxJobs);
  const jobs: ProcessJobsResult["jobs"] = [];

  for (const jobId of jobIds.slice(0, maxJobs)) {
    const step = await runExtractionJobStep(jobId, {
      maxChunks: process.env.JOB_STEP_MAX_CHUNKS ? Number(process.env.JOB_STEP_MAX_CHUNKS) || 1 : undefined,
      maxRuntimeMs: Number(process.env.JOB_STEP_MAX_RUNTIME_MS ?? 45000) || 45000,
      mode: input.jobId ? "manual" : "cron",
    });
    const after = await readJobStatus(jobId);
    jobs.push({
      jobId,
      status: after?.status ?? "skipped",
      message: step.message,
    });
  }

  return {
    ok: true,
    processed: jobs.filter((job) => job.status === "completed").length,
    skipped: jobs.filter((job) => job.status === "skipped" || job.message.startsWith("Skipped")).length,
    failed: jobs.filter((job) => job.status === "failed").length,
    jobs,
  };
}

export async function runExtractionJobStep(jobId: string, options: ExtractionJobStepOptions = {}): Promise<ExtractionJobStepResult> {
  const startedAt = Date.now();
  const maxChunks = Math.max(1, Number(options.maxChunks ?? process.env.JOB_STEP_MAX_CHUNKS ?? defaultMaxChunksForMode(options.mode)) || 1);
  const maxRuntimeMs = Math.max(5000, Number(options.maxRuntimeMs ?? process.env.JOB_STEP_MAX_RUNTIME_MS ?? 45000) || 45000);
  const owner = `${options.mode ?? "manual"}-${crypto.randomUUID()}`;
  const lease = await tryAcquireJobLease(jobId, owner, Number(process.env.JOB_LOCK_TTL_MS ?? 120000) || 120000);
  if (!lease.acquired) {
    return { ok: true, jobId, didWork: false, completed: false, processedChunks: 0, message: `Skipped: ${lease.reason}.` };
  }

  try {
    const status = await readJobStatus(jobId);
    if (!status) return { ok: true, jobId, didWork: false, completed: false, processedChunks: 0, message: "Skipped: job status not found." };
    if (status.status === "completed") return { ok: true, jobId, didWork: false, completed: true, processedChunks: 0, message: "Skipped completed job." };
    if (status.status === "cancelled") return { ok: true, jobId, didWork: false, completed: false, processedChunks: 0, message: "Skipped cancelled job." };

    const manifest = await readJobManifest(jobId);
    if (!manifest) throw new Error(`Missing job manifest for ${jobId}.`);

    const stage = status.currentStage === "processing" ? status.status : status.currentStage;
    if (status.status === "queued" || stage === "queued") {
      await patchJobStatus(jobId, { status: "extracting_text", currentStage: "extracting_text", progress: 5, manifestPath: JOB_PATHS.manifest(jobId) });
      return { ok: true, jobId, didWork: true, completed: false, nextStage: "extracting_text", processedChunks: 0, message: "Moved job to text extraction." };
    }

    if (stage === "extracting_text" || status.status === "extracting_text") {
      const files = manifest.files?.length ? manifest.files : [manifest.file];
      const parsedDocuments = await parseSourceFiles(jobId, files);
      await writeJsonBlob(JOB_PATHS.parsedDocuments(jobId), parsedDocuments);
      await patchJobStatus(jobId, { status: "chunking", currentStage: "chunking", progress: 22 });
      return { ok: true, jobId, didWork: true, completed: false, nextStage: "chunking", processedChunks: 0, message: "Parsed source text and checkpointed parsed documents." };
    }

    if (stage === "chunking" || status.status === "chunking") {
      const parsedDocuments = await readParsedDocuments(jobId);
      const chunks = parsedDocuments.flatMap((doc) => splitPagesIntoChunks(pageRecordsFromDocument(doc), manifest.mode));
      const nextManifest = withChunks(manifest, chunks);
      await eachWithConcurrency(chunks, 8, async (chunk) => {
        await writeJsonBlob(JOB_PATHS.pageChunk(jobId, chunk.pageStart, chunk.pageEnd), chunk);
      });
      nextManifest.chunks = nextManifest.chunks.map((chunk) => ({ ...chunk, textPath: chunk.textPath ?? JOB_PATHS.pageChunk(jobId, chunk.pageStart, chunk.pageEnd) }));
      await writeJobManifest(nextManifest);
      await patchJobStatus(jobId, { status: "extracting_candidates", currentStage: "extracting_candidates", progress: 25, totalChunks: chunks.length });
      return { ok: true, jobId, didWork: true, completed: false, nextStage: "extracting_candidates", processedChunks: 0, message: `Created ${chunks.length} chunks.` };
    }

    if (stage === "extracting_candidates" || stage === "calling_openai" || status.status === "extracting_candidates" || status.status === "calling_openai") {
      const latestManifest = await readJobManifest(jobId);
      if (!latestManifest) throw new Error(`Missing job manifest for ${jobId}.`);
      let processedChunks = 0;
      for (let index = 0; index < latestManifest.chunks.length; index += 1) {
        if (processedChunks >= maxChunks || Date.now() - startedAt > maxRuntimeMs) break;
        if (Date.now() - startedAt > maxRuntimeMs - minChunkBudgetMs()) break;
        const currentChunk = latestManifest.chunks[index]!;
        if (currentChunk.status === "completed" && currentChunk.candidatesPath) continue;
        await ensureNotCancelled(jobId);
        const chunk = await readChunkRecord(jobId, currentChunk);
        const baseProgress = 25 + Math.round((index / Math.max(1, latestManifest.chunks.length)) * 58);
        await patchJobStatus(jobId, {
          status: "extracting_candidates",
          currentStage: "calling_openai",
          currentChunk: chunk.chunkId,
          totalChunks: latestManifest.chunks.length,
          progress: baseProgress,
        });
        latestManifest.chunks[index] = { ...currentChunk, status: "processing" };
        await writeJobManifest(latestManifest);
        const pipelineResult = await runChunkExtraction(chunk, latestManifest.mode);
        const candidatesPath = JOB_PATHS.candidates(jobId, chunk.chunkId);
        await writeJsonBlob(candidatesPath, { ...pipelineResult, lightweightCandidates: lightweightCandidateSummary(chunk) });
        latestManifest.chunks[index] = {
          ...currentChunk,
          status: "completed",
          textPath: currentChunk.textPath ?? JOB_PATHS.pageChunk(jobId, chunk.pageStart, chunk.pageEnd),
          candidatesPath,
          error: undefined,
        };
        await writeJobManifest(latestManifest);
        processedChunks += 1;
        await patchJobStatus(jobId, {
          status: "extracting_candidates",
          currentStage: "extracting_candidates",
          currentChunk: chunk.chunkId,
          totalChunks: latestManifest.chunks.length,
          progress: Math.min(84, baseProgress + 4),
        });
      }

      const refreshedManifest = await readJobManifest(jobId);
      const allDone = Boolean(refreshedManifest?.chunks.length) && refreshedManifest!.chunks.every((chunk) => chunk.status === "completed" && chunk.candidatesPath);
      if (allDone) {
        await patchJobStatus(jobId, { status: "merging_chunks", currentStage: "merging_chunks", progress: 86, currentChunk: undefined });
        return { ok: true, jobId, didWork: true, completed: false, nextStage: "merging_chunks", processedChunks, message: "All chunks completed; moved to merge stage." };
      }
      return { ok: true, jobId, didWork: processedChunks > 0, completed: false, nextStage: "extracting_candidates", processedChunks, message: processedChunks ? `Processed ${processedChunks} chunk(s).` : "No chunk processed within this step budget." };
    }

    if (stage === "merging_chunks" || status.status === "merging_chunks") {
      const result = await mergeCompletedChunks(jobId, manifest.mode);
      const resultBlob = await writeJsonBlob(JOB_PATHS.examPack(jobId), result);
      await writeJsonBlob(JOB_PATHS.merged(jobId), { jobId, resultPath: resultBlob.pathname, resultUrl: resultBlob.url, mergedAt: new Date().toISOString() });
      await patchJobStatus(jobId, { status: "building_pack", currentStage: "building_pack", progress: 92, resultPath: resultBlob.pathname, resultUrl: resultBlob.url });
      return { ok: true, jobId, didWork: true, completed: false, nextStage: "building_pack", processedChunks: 0, message: "Merged chunks and wrote exam-pack JSON." };
    }

    if (stage === "building_pack" || status.status === "building_pack") {
      const latestManifest = await readJobManifest(jobId);
      const chunks = latestManifest ? await readAllChunks(jobId, latestManifest) : [];
      const result = status.resultPath ? await readJsonBlob<ExamPackJobResult>(status.resultPath) : null;
      const debugBlob = await writeJsonBlob(JOB_PATHS.debug(jobId), buildDebugJson({ manifest: latestManifest ?? manifest, chunks, result: result ?? undefined }));
      await patchJobStatus(jobId, { status: "completed", currentStage: "completed", progress: 100, currentChunk: undefined, debugPath: debugBlob.pathname, debugUrl: debugBlob.url });
      return { ok: true, jobId, didWork: true, completed: true, nextStage: "completed", processedChunks: 0, message: "Completed job and wrote debug JSON." };
    }

    return { ok: true, jobId, didWork: false, completed: false, nextStage: status.currentStage, processedChunks: 0, message: `No step available for ${status.currentStage}.` };
  } catch (error) {
    const structured = structuredError(error);
    await failJob(jobId, structured, structured.stage);
    return { ok: true, jobId, didWork: true, completed: false, nextStage: "failed", processedChunks: 0, message: structured.message };
  } finally {
    await releaseJobLease(jobId, owner);
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

async function readParsedDocuments(jobId: string) {
  const parsed = await readJsonBlob<ParsedDocument[]>(JOB_PATHS.parsedDocuments(jobId));
  if (!parsed?.length) throw new Error(`Missing parsed document checkpoint for ${jobId}.`);
  return parsed;
}

async function readChunkRecord(jobId: string, chunk: ExtractionJobManifest["chunks"][number]) {
  const textPath = chunk.textPath ?? JOB_PATHS.pageChunk(jobId, chunk.pageStart, chunk.pageEnd);
  const record = await readJsonBlob<ChunkRecord>(textPath);
  if (!record) throw new Error(`Missing chunk text checkpoint for ${chunk.chunkId}.`);
  return record;
}

async function readAllChunks(jobId: string, manifest: ExtractionJobManifest) {
  const chunks: ChunkRecord[] = [];
  for (const chunk of manifest.chunks) {
    const record = await readChunkRecord(jobId, chunk).catch(() => null);
    if (record) chunks.push(record);
  }
  return chunks;
}

async function mergeCompletedChunks(jobId: string, mode: ExtractionMode) {
  const manifest = await readJobManifest(jobId);
  if (!manifest) throw new Error(`Missing job manifest for ${jobId}.`);
  const parsedDocuments = await readParsedDocuments(jobId);
  const chunkResults = await mapWithConcurrency(manifest.chunks, 6, async (chunk) => {
    if (chunk.status !== "completed" || !chunk.candidatesPath) {
      throw Object.assign(new Error(`Cannot merge before ${chunk.chunkId} is complete.`), {
        errorCode: "MERGE_FAILED",
        stage: "merging_chunks",
        chunkId: chunk.chunkId,
      });
    }
    const result = await readJsonBlob<PipelineResult>(chunk.candidatesPath);
    if (!result) {
      throw Object.assign(new Error(`Missing candidate checkpoint for ${chunk.chunkId}.`), {
        errorCode: "MERGE_FAILED",
        stage: "merging_chunks",
        chunkId: chunk.chunkId,
      });
    }
    return result;
  });
  return mergeChunkPipelineResults({
    jobId,
    mode,
    sourceFiles: parsedDocuments.map((doc, index) => ({
      id: `${jobId}-${index}`,
      name: doc.sourceFile,
      role: doc.role ?? "other",
      parsedText: doc.fullText,
      pages: doc.pages?.map((page) => ({ pageNumber: page.pageNumber, text: page.text })),
    })),
    chunkResults,
  });
}

function defaultMaxChunksForMode(mode?: ExtractionJobStepOptions["mode"]) {
  if (mode === "manual") return 2;
  if (mode === "queue") return 2;
  return 2;
}

function minChunkBudgetMs() {
  return Math.max(3000, Number(process.env.JOB_STEP_MIN_CHUNK_BUDGET_MS ?? 12000) || 12000);
}

async function eachWithConcurrency<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>) {
  await mapWithConcurrency(items, concurrency, async (item, index) => {
    await task(item, index);
    return undefined;
  });
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>) {
  const size = Math.max(1, Math.min(concurrency, items.length || 1));
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await task(items[index]!, index);
      }
    }),
  );
  return results;
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
