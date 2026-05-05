import { NextResponse } from "next/server";
import { readJsonBlob } from "@/lib/jobs/blob-store";
import { readJobStatus } from "@/lib/jobs/status-store";
import type { ExamPackJobResult } from "@/lib/jobs/types";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const section = new URL(request.url).searchParams.get("section") ?? "summary";
  const status = await readJobStatus(jobId);
  if (!status) return NextResponse.json({ ok: false, error: "Job not found." }, { status: 404 });
  if (status.status !== "completed" || !status.resultPath) {
    return NextResponse.json({ ok: false, jobId, status: status.status, error: "Result is not ready yet." }, { status: 409 });
  }

  if (section === "summary") {
    return NextResponse.json({
      ok: true,
      jobId,
      status: status.status,
      resultPath: status.resultPath,
      resultUrl: status.resultUrl,
      debugPath: status.debugPath,
      debugUrl: status.debugUrl,
    });
  }

  const result = await readJsonBlob<ExamPackJobResult>(status.resultPath);
  if (!result) return NextResponse.json({ ok: false, error: "Result JSON could not be read." }, { status: 404 });
  if (section === "formulas") return NextResponse.json({ ok: true, formulas: result.pack.formulas });
  if (section === "debug") return NextResponse.json({ ok: true, debugUrl: status.debugUrl, debugPath: status.debugPath });
  if (section === "pack") return NextResponse.json({ ok: true, pack: result.pack });
  return NextResponse.json({
    ok: true,
    jobId,
    status: status.status,
    resultPath: status.resultPath,
    resultUrl: status.resultUrl,
    debugPath: status.debugPath,
    debugUrl: status.debugUrl,
  });
}

