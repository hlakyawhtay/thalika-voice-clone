import { localIsoString } from "@/lib/file-utils";
import { normalizeBurmeseScript } from "@/lib/burmese-normalizer";
import { preflightProvider } from "@/lib/provider-capabilities";
import { getProvider } from "@/lib/providers";
import { RemoteProviderError } from "@/lib/providers/hf-utils";
import { createJobId, saveJob } from "@/lib/storage/job-store";
import { readBurmeseLexicon } from "@/lib/storage/burmese-lexicon-store";
import { saveScript } from "@/lib/storage/script-store";
import { getVoiceProfile } from "@/lib/storage/voice-profile-store";
import type { GenerateVoiceRequest, GenerateVoiceResult, ProviderPreflightResult } from "@/lib/types";

export class ProviderPreflightError extends Error {
  constructor(public preflight: ProviderPreflightResult) {
    super(preflight.message);
    this.name = "ProviderPreflightError";
  }
}

export interface GenerationSuccess {
  jobId: string;
  scriptId: string;
  status: "completed";
  audioUrl: string;
  filename: string;
  provider: GenerateVoiceRequest["provider"];
  format: GenerateVoiceRequest["format"];
  createdAt: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface GenerationAccepted {
  jobId: string;
  scriptId: string;
  status: "generating";
  provider: GenerateVoiceRequest["provider"];
  format: GenerateVoiceRequest["format"];
  createdAt: string;
  progressMessage: string;
}

type BaseJob = {
  id: string;
  scriptId: string;
  title: string;
  provider: GenerateVoiceRequest["provider"];
  format: GenerateVoiceRequest["format"];
  speed: GenerateVoiceRequest["speed"];
  emotion: GenerateVoiceRequest["emotion"];
  voiceProfileId?: string;
  lexiconRevision?: string;
  normalizationChanges: number;
  referenceQualityScore?: number;
  referenceTranscriptUsed: boolean;
  createdAt: string;
};

interface PreparedGeneration {
  effectiveInput: GenerateVoiceRequest;
  scriptRecord: Awaited<ReturnType<typeof saveScript>>;
  baseJob: BaseJob;
}

function providerErrorMessage(error: unknown) {
  if (error instanceof RemoteProviderError) return error.publicMessage;
  if (error instanceof Error) return error.message;
  return "Audio generation failed";
}

function formatJobContent(providerName: string, audio: GenerateVoiceResult) {
  const metadata = audio.metadata ? `\nMetadata: ${JSON.stringify(audio.metadata)}` : "";
  return `Generated voice metadata.\n\nProvider: ${providerName}\nFormat: ${audio.format}\nAudio file: ${audio.filename}${metadata}`;
}

async function prepareGeneration(input: GenerateVoiceRequest): Promise<PreparedGeneration> {
  let effectiveInput = { ...input };
  if (input.voiceProfileId) {
    const saved = await getVoiceProfile(input.voiceProfileId);
    effectiveInput = {
      ...effectiveInput,
      referenceAudio: effectiveInput.referenceAudio || saved.referenceAudio,
      referenceText: effectiveInput.referenceText || saved.profile.referenceText,
      referenceQualityReport: effectiveInput.referenceQualityReport || saved.profile.qualityReport
    };
  }
  if (effectiveInput.provider === "burmese_production" && effectiveInput.referenceQualityReport?.status === "block") {
    throw new RemoteProviderError("Blocked reference audio", {
      publicMessage: "Reference audio quality is blocked. Upload a cleaner voice sample."
    });
  }

  let normalizationChanges = 0;
  if (effectiveInput.provider === "burmese_production") {
    const lexicon = await readBurmeseLexicon();
    const normalized = normalizeBurmeseScript(effectiveInput.script, lexicon.entries, lexicon.revision);
    if (
      !effectiveInput.normalizationApproved ||
      effectiveInput.lexiconRevision !== lexicon.revision ||
      effectiveInput.approvedNormalizedScript !== normalized.normalizedScript
    ) {
      throw new RemoteProviderError("Burmese normalization approval required", {
        publicMessage: "Burmese pronunciation preview changed. Review and approve it before generation."
      });
    }
    normalizationChanges = normalized.changes.length;
    effectiveInput = { ...effectiveInput, script: normalized.normalizedScript };
  }

  const preflight = preflightProvider(effectiveInput);
  if (!preflight.ok) {
    throw new ProviderPreflightError(preflight);
  }

  const scriptRecord = await saveScript({ title: effectiveInput.title, script: effectiveInput.script, kind: "snapshot" });
  const jobId = createJobId();
  const createdAt = localIsoString();
  const baseJob = {
    id: jobId,
    scriptId: scriptRecord.id,
    title: scriptRecord.title,
    provider: effectiveInput.provider,
    format: effectiveInput.format,
    speed: effectiveInput.speed,
    emotion: effectiveInput.emotion,
    voiceProfileId: effectiveInput.voiceProfileId,
    lexiconRevision: effectiveInput.lexiconRevision,
    normalizationChanges,
    referenceQualityScore: effectiveInput.referenceQualityReport?.score,
    referenceTranscriptUsed: Boolean(effectiveInput.referenceText?.trim()),
    createdAt
  };

  await saveJob({
    ...baseJob,
    status: "generating",
    completedChunks: 0,
    totalChunks: 0,
    progressMessage: "Preparing audio generation.",
    content: "Generation is in progress."
  });

  return { effectiveInput, scriptRecord, baseJob };
}

async function runPreparedGeneration({ effectiveInput, scriptRecord, baseJob }: PreparedGeneration): Promise<GenerationSuccess> {
  try {
    const provider = getProvider(effectiveInput.provider);
    const audio = await provider.generate({
      ...effectiveInput,
      jobId: baseJob.id,
      scriptId: scriptRecord.id,
      title: scriptRecord.title,
      onProgress: async (progress) => {
        await saveJob({
          ...baseJob,
          status: "generating",
          ...progress,
          progressMessage: progress.message,
          content: progress.message
        });
      }
    });

    const job = await saveJob({
      ...baseJob,
      format: audio.format,
      status: "completed",
      audioFile: audio.filename,
      createdAt: baseJob.createdAt,
      content: formatJobContent(provider.name, audio)
    });

    return {
      jobId: job.id,
      scriptId: scriptRecord.id,
      status: "completed",
      audioUrl: audio.localAudioUrl || `/api/audio/${audio.filename}`,
      filename: audio.filename,
      provider: effectiveInput.provider,
      format: audio.format,
      createdAt: job.createdAt,
      metadata: audio.metadata
    };
  } catch (error) {
    const specificMessage = providerErrorMessage(error);
    await saveJob({
      ...baseJob,
      status: "failed",
      error: specificMessage,
      createdAt: baseJob.createdAt,
      content: "Generation failed before audio output was created."
    });

    throw new RemoteProviderError("Voice generation failed", {
      publicMessage: specificMessage
    });
  }
}

export async function generateVoice(input: GenerateVoiceRequest): Promise<GenerationSuccess> {
  const prepared = await prepareGeneration(input);
  return runPreparedGeneration(prepared);
}

export async function startGenerationJob(input: GenerateVoiceRequest): Promise<GenerationAccepted> {
  const prepared = await prepareGeneration(input);

  void runPreparedGeneration(prepared).catch(() => {
    // runPreparedGeneration persists the failure into the job file.
  });

  return {
    jobId: prepared.baseJob.id,
    scriptId: prepared.scriptRecord.id,
    status: "generating",
    provider: prepared.effectiveInput.provider,
    format: prepared.effectiveInput.format,
    createdAt: prepared.baseJob.createdAt,
    progressMessage: "Preparing audio generation."
  };
}
