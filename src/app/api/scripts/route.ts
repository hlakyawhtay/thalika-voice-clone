import { NextResponse } from "next/server";
import { z } from "zod";
import { listScripts, saveScript } from "@/lib/storage/script-store";

export const runtime = "nodejs";

const createScriptSchema = z.object({
  title: z.string().trim().max(150).optional().or(z.literal("")),
  script: z.string().trim().min(10, "Script must be at least 10 characters"),
  order: z.number().int().min(0).optional()
});

export async function GET() {
  const scripts = await listScripts(200);
  return NextResponse.json({ scripts });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = createScriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(". ") },
      { status: 400 }
    );
  }

  const script = await saveScript({
    title: parsed.data.title,
    script: parsed.data.script,
    kind: "chapter",
    order: parsed.data.order
  });
  return NextResponse.json({ ok: true, script }, { status: 201 });
}
