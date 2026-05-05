import { NextResponse } from "next/server";
import { requireCronAuthorization } from "@/lib/jobs/env";
import { processExtractionJobs } from "@/lib/jobs/worker";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function GET(request: Request) {
  const authError = requireCronAuthorization(request);
  if (authError) return NextResponse.json({ ok: false, error: authError }, { status: 401 });
  const result = await processExtractionJobs({ maxJobs: Number(process.env.CRON_MAX_JOBS ?? 1) || 1 });
  return NextResponse.json(result);
}

