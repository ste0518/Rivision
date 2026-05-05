import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = parsePayload(clientPayload);
        if (!payload.jobId || !pathname.startsWith(`uploads/${payload.jobId}/`)) {
          throw new Error("Upload path does not match the extraction job.");
        }
        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "text/plain",
            "text/markdown",
            "application/octet-stream",
          ],
          maximumSizeInBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 1024 * 1024 * 1024),
          addRandomSuffix: false,
          allowOverwrite: true,
          tokenPayload: JSON.stringify(payload),
        };
      },
      onUploadCompleted: async () => undefined,
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare Blob upload." },
      { status: 400 },
    );
  }
}

function parsePayload(payload: string | null): { jobId?: string } {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as { jobId?: string };
  } catch {
    return {};
  }
}

