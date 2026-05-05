import { JOB_PATHS, readJsonBlob, writeJsonBlob } from "@/lib/jobs/blob-store";
import type { ExtractionJobManifest, ExtractionJobStatus, ExtractionJobStatusRecord, StructuredJobError } from "@/lib/jobs/types";

export function initialJobStatus(jobId: string): ExtractionJobStatusRecord {
  const now = new Date().toISOString();
  return {
    ok: true,
    jobId,
    status: "queued",
    progress: 0,
    currentStage: "queued",
    createdAt: now,
    updatedAt: now,
  };
}

export async function readJobStatus(jobId: string) {
  return readJsonBlob<ExtractionJobStatusRecord>(JOB_PATHS.status(jobId));
}

export async function writeJobStatus(status: ExtractionJobStatusRecord) {
  return writeJsonBlob(JOB_PATHS.status(status.jobId), { ...status, updatedAt: new Date().toISOString() });
}

export async function patchJobStatus(
  jobId: string,
  patch: Partial<Omit<ExtractionJobStatusRecord, "ok" | "jobId" | "createdAt">>,
) {
  const current = (await readJobStatus(jobId)) ?? initialJobStatus(jobId);
  const next: ExtractionJobStatusRecord = {
    ...current,
    ...patch,
    status: patch.status ?? current.status,
    currentStage: patch.currentStage ?? patch.status ?? current.currentStage,
    updatedAt: new Date().toISOString(),
  };
  await writeJobStatus(next);
  return next;
}

export async function failJob(jobId: string, error: StructuredJobError, stage?: ExtractionJobStatus) {
  return patchJobStatus(jobId, {
    status: "failed",
    currentStage: stage ?? error.stage ?? "failed",
    error,
  });
}

export async function readJobManifest(jobId: string) {
  return readJsonBlob<ExtractionJobManifest>(JOB_PATHS.manifest(jobId));
}

export async function writeJobManifest(manifest: ExtractionJobManifest) {
  return writeJsonBlob(JOB_PATHS.manifest(manifest.jobId), { ...manifest, updatedAt: new Date().toISOString() });
}

