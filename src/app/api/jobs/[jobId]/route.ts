import { NextResponse } from "next/server";
import { readJobStatus } from "@/lib/jobs/status-store";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const status = await readJobStatus(jobId);
  if (!status) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  return NextResponse.json(status);
}

