import { NextResponse } from "next/server";
import { runExtractionJob } from "@/lib/jobs/worker";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request) {
  const expectedToken = process.env.JOB_WORKER_TOKEN?.trim();
  if (expectedToken) {
    const authorization = request.headers.get("authorization") ?? "";
    if (authorization !== `Bearer ${expectedToken}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized job worker request." }, { status: 401 });
    }
  }

  const body = (await request.json()) as { jobId?: string };
  if (!body.jobId) return NextResponse.json({ ok: false, error: "Missing jobId." }, { status: 400 });
  const status = await runExtractionJob(body.jobId);
  return NextResponse.json(status ?? { ok: false, error: "Job did not return a status." });
}

