import { NextResponse } from "next/server";
import { RemoteProviderError } from "@/lib/providers/hf-utils";
import { resumeGenerationJob } from "@/lib/services/generation-service";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  try {
    const accepted = await resumeGenerationJob(jobId);
    return NextResponse.json(accepted, { status: 202 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ status: "failed", error: "Generation state not found. Start a new generation." }, { status: 404 });
    }

    const message = error instanceof RemoteProviderError ? error.publicMessage : error instanceof Error ? error.message : "Could not retry generation";
    return NextResponse.json({ status: "failed", error: message, message }, { status: 400 });
  }
}
