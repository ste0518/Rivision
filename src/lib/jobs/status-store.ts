import { JOB_PATHS, deleteBlobPath, listBlobPathnames, readJsonBlob, writeJsonBlob } from "@/lib/jobs/blob-store";
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

export async function tryAcquireJobLease(jobId: string, owner: string, ttlMs = Number(process.env.JOB_LOCK_TTL_MS ?? 120000)) {
  const status = await readJobStatus(jobId);
  if (!status) return { acquired: false as const, reason: "missing-status" };
  if (status.status === "completed" || status.status === "cancelled") return { acquired: false as const, reason: status.status };

  const now = Date.now();
  const leaseExpires = status.leaseExpiresAt ? Date.parse(status.leaseExpiresAt) : 0;
  const updatedAt = Date.parse(status.updatedAt);
  const staleThreshold = Number(process.env.JOB_LOCK_TTL_MS ?? 120000);
  const staleProcessing = status.status === "processing" && Number.isFinite(updatedAt) && now - updatedAt > staleThreshold;
  if (status.leaseOwner && leaseExpires > now && !staleProcessing) {
    return { acquired: false as const, reason: "locked" };
  }

  const next = await patchJobStatus(jobId, {
    status: status.status === "queued" || status.status === "failed" ? "processing" : status.status,
    leaseOwner: owner,
    leaseExpiresAt: new Date(now + ttlMs).toISOString(),
  });
  await writeJsonBlob(JOB_PATHS.lock(jobId), {
    jobId,
    owner,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: next.leaseExpiresAt,
  });
  return { acquired: true as const, status: next };
}

export async function releaseJobLease(jobId: string, owner: string) {
  const status = await readJobStatus(jobId);
  if (status?.leaseOwner === owner) {
    await patchJobStatus(jobId, { leaseOwner: undefined, leaseExpiresAt: undefined });
  }
  await deleteBlobPath(JOB_PATHS.lock(jobId));
}

export async function findQueuedJobIds(limit = 10) {
  const pathnames = await listBlobPathnames("jobs/", Math.max(10, limit * 4));
  const statusPaths = pathnames.filter((pathname) => pathname.endsWith("/status.json"));
  const queued: string[] = [];
  for (const pathname of statusPaths) {
    if (queued.length >= limit) break;
    const match = /^jobs\/([^/]+)\/status\.json$/.exec(pathname);
    const jobId = match?.[1];
    if (!jobId) continue;
    const status = await readJobStatus(jobId);
    if (
      status &&
      status.status !== "completed" &&
      status.status !== "cancelled"
    ) queued.push(jobId);
  }
  return queued;
}

export async function readJobManifest(jobId: string) {
  return readJsonBlob<ExtractionJobManifest>(JOB_PATHS.manifest(jobId));
}

export async function writeJobManifest(manifest: ExtractionJobManifest) {
  return writeJsonBlob(JOB_PATHS.manifest(manifest.jobId), { ...manifest, updatedAt: new Date().toISOString() });
}
