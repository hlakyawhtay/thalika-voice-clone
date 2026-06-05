import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteScript, getScriptById, updateScript } from "@/lib/storage/script-store";

export const runtime = "nodejs";

const updateScriptSchema = z.object({
  title: z.string().trim().max(150).optional().or(z.literal("")),
  script: z.string().trim().min(10, "Script must be at least 10 characters").optional(),
  order: z.number().int().min(0).optional()
});

export async function GET(_request: Request, context: { params: Promise<{ scriptId: string }> }) {
  const { scriptId } = await context.params;

  try {
    const script = await getScriptById(scriptId);
    return NextResponse.json({ script });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "Script not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not read script" }, { status: 400 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ scriptId: string }> }) {
  const { scriptId } = await context.params;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = updateScriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(". ") },
      { status: 400 }
    );
  }

  try {
    const script = await updateScript({ id: scriptId, ...parsed.data });
    return NextResponse.json({ ok: true, script });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "Script not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not update script" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ scriptId: string }> }) {
  const { scriptId } = await context.params;

  try {
    const deleted = await deleteScript(scriptId);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return NextResponse.json({ ok: false, error: "Script not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Could not delete script" }, { status: 400 });
  }
}
