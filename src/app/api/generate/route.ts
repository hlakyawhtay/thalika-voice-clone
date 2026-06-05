import { NextResponse } from "next/server";
import { formatValidationError, generateRequestSchema } from "@/lib/validators";
import { RemoteProviderError } from "@/lib/providers/hf-utils";
import { ProviderPreflightError, startGenerationJob } from "@/lib/services/generation-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let parsed;

  try {
    const body = await request.json();
    parsed = generateRequestSchema.safeParse(body);
  } catch {
    return NextResponse.json({ status: "failed", error: "Invalid JSON request body" }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json({ status: "failed", error: formatValidationError(parsed.error) }, { status: 400 });
  }

  try {
    return NextResponse.json(await startGenerationJob(parsed.data), { status: 202 });
  } catch (error) {
    if (error instanceof ProviderPreflightError) {
      return NextResponse.json(
        {
          status: "failed",
          error: error.preflight.message,
          message: error.preflight.nextStep,
          preflight: error.preflight
        },
        { status: 422 }
      );
    }

    const specificMessage = error instanceof RemoteProviderError ? error.publicMessage : error instanceof Error ? error.message : "Audio generation failed";
    return NextResponse.json({ status: "failed", error: specificMessage, message: specificMessage }, { status: 500 });
  }
}
