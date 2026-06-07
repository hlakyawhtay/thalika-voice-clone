import { NextResponse } from "next/server";
import { z } from "zod";
import { GEMINI_REWRITE_MODELS, type GeminiRewriteModel } from "@/lib/script-rewrite";
import { readStudioSettings, saveStudioSettings } from "@/lib/storage/studio-settings-store";

export const runtime = "nodejs";

const referenceAudioSchema = z.object({
  dataUrl: z.string().startsWith("data:audio/"),
  filename: z.string().min(1).max(150),
  mimeType: z.string().startsWith("audio/"),
  size: z.number().positive().max(10 * 1024 * 1024),
  durationSeconds: z.number().positive().optional()
});

const referenceQualitySchema = z.object({
  durationSeconds: z.number().positive(),
  silenceRatio: z.number().min(0).max(1),
  clippingRatio: z.number().min(0).max(1),
  rms: z.number().finite().min(0).max(16),
  peak: z.number().finite().min(0).max(16),
  score: z.number().min(0).max(100),
  status: z.enum(["pass", "warn", "block"]),
  issues: z.array(z.string().max(200)).max(20)
});

const settingsSchema = z.object({
  rewriteModel: z.enum(GEMINI_REWRITE_MODELS.map((item) => item.id) as [GeminiRewriteModel, ...GeminiRewriteModel[]]).optional(),
  keepBurmese: z.boolean().optional(),
  provider: z.enum(["voxcpm2", "burmese_production"]).optional(),
  speed: z.number().min(0.8).max(1.2).optional(),
  emotion: z.enum(["neutral", "calm", "energetic", "dramatic"]).optional(),
  voiceGender: z.enum(["auto", "male", "female"]).optional(),
  voicePrompt: z.string().trim().max(500).optional().or(z.literal("")),
  cloneMode: z.enum(["balanced", "high_fidelity"]).optional(),
  cloneStrength: z.number().min(1).max(3).optional(),
  denoiseReference: z.boolean().optional(),
  normalizeText: z.boolean().optional(),
  referenceAudio: referenceAudioSchema.nullable().optional(),
  referenceText: z.string().trim().max(2000).optional().or(z.literal("")),
  referenceQualityReport: referenceQualitySchema.nullable().optional(),
  selectedProfileId: z.string().regex(/^profile_[a-zA-Z0-9_-]+$/).optional().or(z.literal(""))
});

export async function GET() {
  const settings = await readStudioSettings();
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(". ") },
      { status: 400 }
    );
  }

  const settings = await saveStudioSettings(parsed.data);
  return NextResponse.json({ ok: true, settings });
}

export async function POST(request: Request) {
  return PUT(request);
}
