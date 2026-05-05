import { NextResponse } from "next/server";
import { jobEnvStatus } from "@/lib/jobs/env";

export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  return NextResponse.json(jobEnvStatus());
}

