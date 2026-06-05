import { NextResponse } from "next/server";
import { deleteJob, getJob } from "@/lib/storage/job-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  try {
    const job = await getJob(jobId);
    return NextResponse.json({
      job,
      audioUrl: job.audioFile ? `/api/audio/${job.audioFile}` : undefined
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "History item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read history item" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params;

  try {
    const deleted = await deleteJob(jobId);
    return NextResponse.json({
      ok: true,
      deleted
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "History item not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not delete history item" }, { status: 400 });
  }
}
