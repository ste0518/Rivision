import { NextResponse } from "next/server";
import { patchJobStatus, readJobStatus } from "@/lib/jobs/status-store";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const current = await readJobStatus(jobId);
  if (!current) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  if (current.status === "completed") return NextResponse.json(current);
  const status = await patchJobStatus(jobId, {
    status: "cancelled",
    currentStage: "cancelled",
    error: {
      errorCode: "JOB_CANCELLED",
      message: "Job cancelled by the user.",
      stage: "cancelled",
      retryable: true,
      debugHint: "Start a new job, or rerun this job if the source file is still in Blob.",
    },
  });
  return NextResponse.json(status);
}

