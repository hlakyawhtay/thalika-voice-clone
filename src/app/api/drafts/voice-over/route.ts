import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteVoiceOverDraft, readVoiceOverDraft, saveVoiceOverDraft } from "@/lib/storage/draft-store";

export const runtime = "nodejs";

const draftSchema = z.object({
  title: z.string().trim().max(100).optional().or(z.literal("")),
  script: z
    .string()
    .trim()
    .optional()
    .or(z.literal("")),
  provider: z.enum(["voxcpm2", "burmese_production"]).optional(),
  speed: z.number().min(0.8).max(1.2).optional(),
  emotion: z.enum(["neutral", "calm", "energetic", "dramatic"]).optional(),
  expressiveness: z.number().min(0.2).max(1).optional(),
  voiceGender: z.enum(["auto", "male", "female"]).optional(),
  voicePrompt: z.string().trim().max(500).optional().or(z.literal("")),
  cloneMode: z.enum(["balanced", "high_fidelity"]).optional(),
  cloneStrength: z.number().min(1).max(3).optional(),
  denoiseReference: z.boolean().optional(),
  normalizeText: z.boolean().optional(),
  referenceAudio: z
    .object({
      dataUrl: z.string().startsWith("data:audio/"),
      filename: z.string().min(1).max(150),
      mimeType: z.string().startsWith("audio/"),
      size: z.number().positive().max(10 * 1024 * 1024),
      durationSeconds: z.number().positive().optional()
    })
    .nullable()
    .optional(),
  referenceText: z.string().trim().max(2000).optional().or(z.literal("")),
  referenceQualityReport: z
    .object({
      durationSeconds: z.number().positive(),
      silenceRatio: z.number().min(0).max(1),
      clippingRatio: z.number().min(0).max(1),
      rms: z.number().finite().min(0).max(16),
      peak: z.number().finite().min(0).max(16),
      score: z.number().min(0).max(100),
      status: z.enum(["pass", "warn", "block"]),
      issues: z.array(z.string().max(200)).max(20)
    })
    .nullable()
    .optional(),
  selectedProfileId: z.string().regex(/^profile_[a-zA-Z0-9_-]+$/).optional().or(z.literal("")),
  normalization: z
    .object({
      originalScript: z.string(),
      normalizedScript: z.string(),
      changes: z
        .array(
          z.object({
            source: z.string(),
            spoken: z.string(),
            reason: z.string()
          })
        )
        .max(500),
      lexiconRevision: z.string().max(100)
    })
    .nullable()
    .optional(),
  normalizationApproved: z.boolean().optional()
});

export async function GET() {
  const draft = await readVoiceOverDraft();
  return NextResponse.json({ draft });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = draftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((issue) => issue.message).join(". ") },
      { status: 400 }
    );
  }

  const draft = await saveVoiceOverDraft(parsed.data);
  return NextResponse.json({ ok: true, draft });
}

export async function DELETE() {
  const deleted = await deleteVoiceOverDraft();
  return NextResponse.json({ ok: true, deleted });
}
