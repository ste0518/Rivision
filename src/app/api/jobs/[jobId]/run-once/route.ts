import { NextResponse } from "next/server";
import { readJobManifest } from "@/lib/jobs/status-store";
import { runExtractionJob, SMALL_DEV_FILE_LIMIT } from "@/lib/jobs/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const manifest = await readJobManifest(jobId);
  if (!manifest) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  const files = manifest.files?.length ? manifest.files : [manifest.file];
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_SYNC_JOB_RUN_ONCE !== "true") {
    return NextResponse.json({ ok: false, error: "run-once is disabled in production. Configure Vercel Queue or Workflow to process this job." }, { status: 403 });
  }
  if (totalSize > SMALL_DEV_FILE_LIMIT && process.env.ALLOW_LARGE_RUN_ONCE !== "true") {
    return NextResponse.json({ ok: false, error: "This file is too large for dev run-once. Use Vercel Queue/Workflow, or split the PDF." }, { status: 413 });
  }
  const status = await runExtractionJob(jobId);
  return NextResponse.json(status ?? { ok: false, error: "Job did not return a status." });
}

