import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBurmeseScript } from "@/lib/burmese-normalizer";
import { startGenerationJob } from "@/lib/services/generation-service";
import { getJob } from "@/lib/storage/job-store";
import { readBurmeseLexicon } from "@/lib/storage/burmese-lexicon-store";
import { getScriptById, updateScriptGenerationState } from "@/lib/storage/script-store";
import type { GenerateVoiceRequest } from "@/lib/types";

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

const queueSchema = z.object({
  scriptIds: z.array(z.string().regex(/^script_[a-zA-Z0-9_-]+$/)).min(1),
  settings: z.object({
    provider: z.enum(["voxcpm2", "burmese_production"]),
    format: z.literal("wav").default("wav"),
    speed: z.number().min(0.8).max(1.2),
    emotion: z.enum(["neutral", "calm", "energetic", "dramatic"]),
    voiceGender: z.enum(["auto", "male", "female"]).optional(),
    voicePrompt: z.string().trim().max(500).optional().or(z.literal("")),
    cloneMode: z.enum(["balanced", "high_fidelity"]).optional(),
    cloneStrength: z.number().min(1).max(3).optional(),
    denoiseReference: z.boolean().optional(),
    normalizeText: z.boolean().optional(),
    referenceAudio: referenceAudioSchema.optional(),
    referenceText: z.string().trim().max(2000).optional().or(z.literal("")),
    voiceProfileId: z.string().regex(/^profile_[a-zA-Z0-9_-]+$/).optional().or(z.literal("")),
    referenceQualityReport: referenceQualitySchema.optional()
  })
});

type QueueRequest = z.infer<typeof queueSchema>;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildGenerationRequest(scriptId: string, settings: QueueRequest["settings"]): Promise<GenerateVoiceRequest> {
  const script = await getScriptById(scriptId);
  const base: GenerateVoiceRequest = {
    title: script.title,
    script: script.content,
    provider: settings.provider,
    format: "wav",
    speed: settings.speed,
    emotion: settings.emotion,
    voiceGender: settings.voiceGender,
    voicePrompt: settings.voicePrompt,
    cloneMode: settings.cloneMode,
    cloneStrength: settings.cloneStrength,
    denoiseReference: settings.denoiseReference,
    normalizeText: settings.normalizeText,
    referenceAudio: settings.referenceAudio,
    referenceText: settings.referenceText,
    voiceProfileId: settings.voiceProfileId || undefined,
    referenceQualityReport: settings.referenceQualityReport
  };

  if (settings.provider !== "burmese_production") return base;

  const lexicon = await readBurmeseLexicon();
  const normalized = normalizeBurmeseScript(script.content, lexicon.entries, lexicon.revision);
  return {
    ...base,
    approvedNormalizedScript: normalized.normalizedScript,
    lexiconRevision: lexicon.revision,
    normalizationApproved: true
  };
}

async function runQueue(request: QueueRequest) {
  for (const scriptId of request.scriptIds) {
    try {
      await updateScriptGenerationState(scriptId, {
        generationStatus: "generating",
        jobId: undefined,
        audioFile: undefined,
        error: undefined,
        completedChunks: 0,
        totalChunks: 0,
        progressMessage: "Starting queued chapter generation."
      });
      const generationRequest = await buildGenerationRequest(scriptId, request.settings);
      const accepted = await startGenerationJob(generationRequest);
      await updateScriptGenerationState(scriptId, {
        generationStatus: "generating",
        jobId: accepted.jobId,
        error: undefined,
        progressMessage: accepted.progressMessage
      });

      while (true) {
        const job = await getJob(accepted.jobId);
        await updateScriptGenerationState(scriptId, {
          generationStatus: job.status,
          jobId: job.id,
          audioFile: job.audioFile,
          error: job.error,
          completedChunks: job.completedChunks,
          totalChunks: job.totalChunks,
          progressMessage: job.progressMessage
        });

        if (job.status === "completed" || job.status === "failed") break;
        await wait(2000);
      }
    } catch (error) {
      await updateScriptGenerationState(scriptId, {
        generationStatus: "failed",
        error: error instanceof Error ? error.message : "Queued generation failed.",
        progressMessage: "Generation failed."
      }).catch(() => undefined);
    }
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON request body" }, { status: 400 });
  }

  const parsed = queueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(". ") },
      { status: 400 }
    );
  }

  await Promise.all(
    parsed.data.scriptIds.map((scriptId) =>
      updateScriptGenerationState(scriptId, {
        generationStatus: "queued",
        jobId: undefined,
        audioFile: undefined,
        error: undefined,
        completedChunks: 0,
        totalChunks: 0,
        progressMessage: "Waiting in audiobook queue."
      })
    )
  );

  void runQueue(parsed.data);

  return NextResponse.json({
    ok: true,
    status: "queued",
    accepted: parsed.data.scriptIds.length
  }, { status: 202 });
}
