import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBurmeseScript } from "@/lib/burmese-normalizer";
import { readBurmeseLexicon } from "@/lib/storage/burmese-lexicon-store";

export const runtime = "nodejs";

const requestSchema = z.object({
  script: z.string().trim().min(10),
  lexiconRevision: z.string().max(100).optional()
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "Invalid Burmese normalization request" }, { status: 400 });
  const lexicon = await readBurmeseLexicon();
  return NextResponse.json(normalizeBurmeseScript(parsed.data.script, lexicon.entries, lexicon.revision));
}
