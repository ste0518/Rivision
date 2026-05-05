import type { CuratedDeckResult, ParsedDocument, StudyFileRole } from "@/lib/types";
import type { GeneratedPracticeQuestion, GeneratedRevisionPack } from "@/lib/student-revision-schema";

export type ExtractionJobStatus =
  | "queued"
  | "processing"
  | "extracting_text"
  | "chunking"
  | "extracting_candidates"
  | "calling_openai"
  | "merging_chunks"
  | "building_pack"
  | "completed"
  | "failed"
  | "cancelled";

export type ExtractionMode = "fast" | "standard" | "deep";

export type ExtractionJobFile = {
  url: string;
  pathname: string;
  filename: string;
  size: number;
  contentType?: string;
  role: StudyFileRole;
};

export type StructuredJobError = {
  errorCode:
    | "BLOB_UPLOAD_FAILED"
    | "PDF_PARSE_FAILED"
    | "TEXT_EXTRACTION_FAILED"
    | "OPENAI_RATE_LIMIT"
    | "OPENAI_TIMEOUT"
    | "CHUNK_FAILED"
    | "MERGE_FAILED"
    | "JOB_CANCELLED";
  message: string;
  stage?: ExtractionJobStatus;
  chunkId?: string;
  retryable: boolean;
  debugHint?: string;
};

export type JobChunkStatus = "pending" | "processing" | "completed" | "failed";

export type JobChunkManifest = {
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  status: JobChunkStatus;
  textPath?: string;
  candidatesPath?: string;
  error?: StructuredJobError;
};

export type ExtractionJobManifest = {
  jobId: string;
  file: ExtractionJobFile;
  files?: ExtractionJobFile[];
  mode: ExtractionMode;
  createdAt: string;
  updatedAt: string;
  stages: ExtractionJobStatus[];
  chunks: JobChunkManifest[];
};

export type ExtractionJobStatusRecord = {
  ok: true;
  jobId: string;
  status: ExtractionJobStatus;
  progress: number;
  currentStage: ExtractionJobStatus;
  currentChunk?: string;
  totalChunks?: number;
  resultPath?: string;
  resultUrl?: string;
  debugPath?: string;
  debugUrl?: string;
  manifestPath?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  error?: StructuredJobError;
  createdAt: string;
  updatedAt: string;
};

export type ChunkRecord = {
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  headings: string[];
  sourceFile: string;
  role: StudyFileRole;
  estimatedTokens: number;
};

export type ChunkExtractionResult = {
  chunk: ChunkRecord;
  parsedDocument: ParsedDocument;
  llmResult?: CuratedDeckResult;
};

export type ExamPackJobResult = {
  jobId: string;
  generatedAt: string;
  mode: ExtractionMode;
  pack: GeneratedRevisionPack;
  practiceQuestions: GeneratedPracticeQuestion[];
  extraction: {
    items: CuratedDeckResult["keptItems"];
    needsReviewItems: CuratedDeckResult["needsReviewItems"];
    rejectedItems: CuratedDeckResult["rejectedItems"];
    embeddedItems: CuratedDeckResult["embeddedItems"];
    courseStructureMap: CuratedDeckResult["courseStructureMap"];
    courseKnowledgeMap: CuratedDeckResult["courseKnowledgeMap"];
    assessmentMap?: CuratedDeckResult["assessmentMap"];
    examPriorityMap?: CuratedDeckResult["examPriorityMap"];
    revisionPack?: CuratedDeckResult["revisionPack"];
    curationReport: CuratedDeckResult["curationReport"];
    verification?: import("@/lib/types").ExtractionVerificationReport;
  };
};

export type ProcessJobSummary = {
  jobId: string;
  status: ExtractionJobStatus | "skipped";
  message: string;
};

export type ProcessJobsResult = {
  ok: true;
  processed: number;
  skipped: number;
  failed: number;
  jobs: ProcessJobSummary[];
};

export type ExtractionJobStepOptions = {
  maxChunks?: number;
  maxRuntimeMs?: number;
  mode?: "cron" | "manual" | "queue";
};

export type ExtractionJobStepResult = {
  ok: true;
  jobId: string;
  didWork: boolean;
  completed: boolean;
  nextStage?: ExtractionJobStatus;
  processedChunks: number;
  message: string;
};
