import { NextResponse } from "next/server";
import { requireProcessAuthorization } from "@/lib/jobs/env";
import { processExtractionJobs } from "@/lib/jobs/worker";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request) {
  const authError = requireProcessAuthorization(request);
  if (authError) return NextResponse.json({ ok: false, error: authError }, { status: 401 });

  const body = await request
    .json()
    .then((value) => value as { jobId?: string; maxJobs?: number })
    .catch(() => ({}));
  const result = await processExtractionJobs({ jobId: body.jobId, maxJobs: body.maxJobs });
  return NextResponse.json(result);
}
