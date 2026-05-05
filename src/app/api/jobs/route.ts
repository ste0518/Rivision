import { NextResponse } from "next/server";
import { enqueueExtractionJob } from "@/lib/jobs/enqueue";
import { JOB_PATHS, writeJsonBlob } from "@/lib/jobs/blob-store";
import { initialJobStatus, writeJobManifest, writeJobStatus } from "@/lib/jobs/status-store";
import type { ExtractionJobFile, ExtractionMode } from "@/lib/jobs/types";
import type { StudyFileRole } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      jobId?: string;
      file?: ExtractionJobFile;
      files?: ExtractionJobFile[];
      mode?: ExtractionMode;
    };
    const jobId = sanitizeJobId(body.jobId) ?? `job_${crypto.randomUUID()}`;
    const files = normaliseFiles(body.files ?? (body.file ? [body.file] : []));
    if (!files.length) {
      return NextResponse.json({ ok: false, error: "At least one uploaded Blob file is required." }, { status: 400 });
    }
    const mode = normaliseMode(body.mode, files);
    const now = new Date().toISOString();

    await writeJsonBlob(JOB_PATHS.uploadMetadata(jobId), { jobId, files, mode, createdAt: now });
    await writeJobManifest({
      jobId,
      file: files[0]!,
      files,
      mode,
      createdAt: now,
      updatedAt: now,
      stages: ["queued"],
      chunks: [],
    });
    const status = {
      ...initialJobStatus(jobId),
      manifestPath: JOB_PATHS.manifest(jobId),
      totalChunks: 0,
    };
    await writeJobStatus(status);
    const enqueue = await enqueueExtractionJob(jobId);

    return NextResponse.json({
      ok: true,
      jobId,
      status: status.status,
      mode,
      enqueue,
      statusPath: JOB_PATHS.status(jobId),
      manifestPath: JOB_PATHS.manifest(jobId),
      runOnceUrl: enqueue.mode === "dev-run-once" ? `/api/jobs/${jobId}/run-once` : undefined,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not create extraction job." }, { status: 500 });
  }
}

function sanitizeJobId(value: unknown) {
  if (typeof value !== "string") return undefined;
  return /^[a-zA-Z0-9_-]{8,80}$/.test(value) ? value : undefined;
}

function normaliseMode(mode: unknown, files: ExtractionJobFile[]): ExtractionMode {
  if (mode === "fast" || mode === "standard" || mode === "deep") return mode;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  return totalSize > 45 * 1024 * 1024 ? "fast" : "standard";
}

function normaliseFiles(files: ExtractionJobFile[]) {
  return files
    .filter((file) => file?.url && file?.pathname && file?.filename)
    .map((file) => ({
      url: file.url,
      pathname: file.pathname,
      filename: file.filename,
      size: Number(file.size) || 0,
      contentType: file.contentType,
      role: normaliseRole(file.role),
    }));
}

function normaliseRole(role: unknown): StudyFileRole {
  const valid: StudyFileRole[] = ["lecture_notes", "exam_guidance", "past_paper", "problem_sheet", "solution_sheet", "formula_sheet", "mark_scheme", "other"];
  return valid.includes(role as StudyFileRole) ? role as StudyFileRole : "other";
}

