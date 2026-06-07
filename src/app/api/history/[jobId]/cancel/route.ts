import { NextResponse } from "next/server";
import { abortActiveJob } from "@/lib/services/job-runtime";
import { requestJobCancellation } from "@/lib/storage/job-store";

export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  try {
    const canceled = await requestJobCancellation(jobId);
    const aborted = abortActiveJob(jobId);

    return NextResponse.json({
      ok: true,
      canceled: canceled.cancelable,
      aborted,
      job: canceled.job
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "History item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not cancel generation" }, { status: 400 });
  }
}
