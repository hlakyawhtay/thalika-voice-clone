import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  convertRemoteAudioToPcm24Wav,
  getPunctuationAwarePauseMilliseconds,
  mergeWavFiles,
  validatePcm24MasterFile
} from "../audio-utils";
import { ensureDataDirs, idStamp, outputsDir, safeJoin, sanitizeFilename } from "../file-utils";
import { GenerationCancelledError } from "../generation-cancellation";
import { getRemoteTtsChunkCharacters } from "../script-limits";
import { splitScriptIntoChunks } from "../script-chunker";
import type { GenerateVoiceInput, GenerateVoiceResult, ReferenceAudioPayload, VoiceEmotion } from "../types";
import { appendGenerationLog } from "../storage/generation-log";
import type { TTSProvider } from "./base";
import {
  assertOkResponse,
  extractAudioUrlFromEvents,
  fetchTextWithTimeout,
  fetchWithTimeout,
  getHFHeaders,
  getHFInferenceTimeout,
  getHFRequestTimeout,
  parseSSEData,
  parseUploadResponse,
  readJsonResponse,
  RemoteProviderError,
  shouldRetryHFError,
  summarizeRemoteEvents,
  TimeoutError,
  withRetry
} from "./hf-utils";
import { getVoxCPM2BaseUrl, VoxCPM2ConfigError } from "./voxcpm2-health";

const emotionControls: Record<VoiceEmotion, string> = {
  neutral: "neutral expression",
  calm: "calm and steady expression",
  energetic: "energetic but speaker-consistent expression",
  dramatic: "expressive but speaker-consistent delivery"
};

const genderControls = {
  auto: "",
  male: "male voice",
  female: "female voice"
} as const;

function speedControl(speed: number) {
  if (speed <= 0.85) return "slow, deliberate pacing";
  if (speed <= 0.95) return "slightly slower pacing";
  if (speed >= 1.15) return "brisk pacing";
  if (speed >= 1.05) return "slightly faster pacing";
  return "natural pacing";
}

function expressivenessControl(expressiveness = 0.7) {
  const value = Math.min(1, Math.max(0.2, expressiveness));
  if (value >= 0.9) return "highly expressive Burmese intonation with strong pitch rise/fall and phrase emphasis";
  if (value >= 0.7) return "expressive Burmese intonation with clear pitch rise/fall and natural sentence-final drops";
  if (value >= 0.5) return "natural Burmese intonation with moderate pitch movement";
  return "steady Burmese intonation with restrained pitch movement";
}

function decodeReferenceAudio(referenceAudio: ReferenceAudioPayload) {
  const match = referenceAudio.dataUrl.match(/^data:(audio\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new RemoteProviderError("Invalid reference audio", {
      publicMessage: "VoxCPM2 requires a valid audio reference file."
    });
  }

  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], "base64")
  };
}

async function uploadReferenceAudio(baseUrl: string, referenceAudio: ReferenceAudioPayload, signal?: AbortSignal) {
  const { bytes, mimeType } = decodeReferenceAudio(referenceAudio);
  const filename = sanitizeFilename(referenceAudio.filename || "reference.wav");
  const form = new FormData();
  form.append("files", new Blob([bytes], { type: mimeType }), filename);

  const response = await fetchWithTimeout(`${baseUrl}/gradio_api/upload`, {
    method: "POST",
    headers: getHFHeaders(),
    body: form,
    signal
  });
  assertOkResponse(response, "VoxCPM2 reference audio upload failed");

  const json = await readJsonResponse<unknown>(response, "Invalid response from VoxCPM2 Space.");
  return parseUploadResponse(json);
}

async function callVoxCPM2(
  baseUrl: string,
  input: GenerateVoiceInput,
  uploadedReferencePath: string | null,
  scriptChunk: string,
  chunkIndex: number,
  chunkCount: number,
  useReferenceTranscript = true
) {
  if (input.abortSignal?.aborted) throw new GenerationCancelledError();
  const cloneMode = input.cloneMode || "high_fidelity";
  const cloneStrength = Math.min(3, Math.max(1, input.cloneStrength ?? (cloneMode === "high_fidelity" ? 2.8 : 2.2)));
  const denoiseReference = input.denoiseReference ?? false;
  const normalizeText = input.normalizeText ?? true;
  const referenceText = uploadedReferencePath && useReferenceTranscript ? input.referenceText?.trim() || "" : "";
  const continuityInstruction =
    chunkCount > 1
      ? ` This is segment ${chunkIndex + 1} of ${chunkCount}; keep the same speaker identity, pace, volume, accent, and emotional style so all segments join naturally.`
      : "";
  const voiceGender = input.voiceGender || "auto";
  const genderInstruction = genderControls[voiceGender];
  const requestedVoice = input.voicePrompt?.trim() || "A natural Burmese-capable narrator voice";
  const voiceDesignPrompt = genderInstruction ? `${genderInstruction}. ${requestedVoice}` : requestedVoice;
  const prosodyInstruction = expressivenessControl(input.expressiveness);
  const controlInstruction = uploadedReferencePath
    ? cloneMode === "high_fidelity"
      ? `${prosodyInstruction}. Preserve speaker timbre, accent, rhythm, breath, tone, style, and pronunciation. Use ${emotionControls[input.emotion]} with ${speedControl(input.speed)}.${continuityInstruction}`
      : `${prosodyInstruction}. Clone speaker timbre while keeping natural speech. Use ${emotionControls[input.emotion]} with ${speedControl(input.speed)}.${continuityInstruction}`
    : `${prosodyInstruction}. ${voiceDesignPrompt}. Use ${emotionControls[input.emotion]} with ${speedControl(input.speed)}.${continuityInstruction}`;
  const referenceFile = uploadedReferencePath
    ? {
        path: uploadedReferencePath,
        orig_name: sanitizeFilename(input.referenceAudio?.filename || "reference.wav"),
        mime_type: input.referenceAudio?.mimeType || "audio/wav",
        meta: { _type: "gradio.FileData" }
      }
    : null;
  const body = {
    data: [
      scriptChunk,
      controlInstruction,
      referenceFile,
      Boolean(referenceText),
      referenceText,
      cloneStrength,
      normalizeText,
      denoiseReference
    ]
  };

  const response = await fetchWithTimeout(`${baseUrl}/gradio_api/call/generate`, {
    method: "POST",
    headers: getHFHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal: input.abortSignal
  });
  assertOkResponse(response, "VoxCPM2 remote inference failed");

  const json = await readJsonResponse<{ event_id?: string }>(response, "Invalid response from VoxCPM2 Space.");
  if (!json.event_id) {
    throw new RemoteProviderError("Missing Gradio event id", {
      publicMessage: "Invalid response from VoxCPM2 Space."
    });
  }

  const { response: resultResponse, text: resultText } = await fetchTextWithTimeout(`${baseUrl}/gradio_api/call/generate/${json.event_id}`, {
    method: "GET",
    headers: getHFHeaders({ Accept: "text/event-stream" }),
    signal: input.abortSignal
  });
  assertOkResponse(resultResponse, "VoxCPM2 remote inference failed");

  const events = parseSSEData(resultText);
  try {
    return extractAudioUrlFromEvents(events, baseUrl);
  } catch (error) {
    await appendGenerationLog("remote_sse_without_audio", {
      jobId: input.jobId,
      chunk: chunkIndex + 1,
      chunks: chunkCount,
      referenceTranscriptRequested: Boolean(referenceText),
      events: JSON.stringify(summarizeRemoteEvents(events)),
      error: diagnosticError(error)
    });
    throw error;
  }
}

async function downloadRemoteAudio(audioUrl: string, signal?: AbortSignal) {
  const response = await fetchWithTimeout(audioUrl, { method: "GET", headers: getHFHeaders(), signal });
  assertOkResponse(response, "VoxCPM2 audio download failed");

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.includes("audio") && !contentType.includes("octet-stream")) {
    throw new RemoteProviderError("Unexpected VoxCPM2 audio response type", {
      publicMessage: "Invalid response from VoxCPM2 Space."
    });
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) {
    throw new RemoteProviderError("Empty VoxCPM2 audio response", {
      publicMessage: "VoxCPM2 audio download failed."
    });
  }

  return bytes;
}

function normalizeVoxCPM2Error(error: unknown) {
  if (error instanceof GenerationCancelledError) return "Generation canceled.";
  if (error instanceof VoxCPM2ConfigError) {
    return "Production requires a private VoxCPM2 backend URL. Do not use the public demo Space.";
  }
  if (error instanceof TimeoutError) return "Remote inference timed out.";
  if (error instanceof RemoteProviderError) return error.publicMessage;
  return "VoxCPM2 remote inference failed";
}

function diagnosticError(error: unknown) {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown remote inference error";
}

function shouldFallbackFromTranscript(error: unknown) {
  return (
    error instanceof RemoteProviderError &&
    (error.message.startsWith("Missing audio output") || error.message.startsWith("Remote Space generation error"))
  );
}

async function generateRemote(input: GenerateVoiceInput) {
  await ensureDataDirs();
  const baseUrl = getVoxCPM2BaseUrl();
  const chunkMaxCharacters = getRemoteTtsChunkCharacters();
  const chunks = splitScriptIntoChunks(input.script, chunkMaxCharacters);
  if (chunks.length === 0) {
    throw new RemoteProviderError("Empty script", {
      publicMessage: "Script is required."
    });
  }

  async function throwIfCancelled() {
    if (input.abortSignal?.aborted || (await input.isCancellationRequested?.())) {
      throw new GenerationCancelledError();
    }
  }

  await throwIfCancelled();

  const uploadedReferencePath = input.referenceAudio
    ? await withRetry(
        () => uploadReferenceAudio(baseUrl, input.referenceAudio!, input.abortSignal),
        shouldRetryHFError,
        2,
        async (error, attempt) => {
          await appendGenerationLog("reference_upload_retry", {
            jobId: input.jobId,
            attempt,
            error: diagnosticError(error)
          });
        }
      )
    : null;
  const outputStem = sanitizeFilename(input.outputStem || `voice_${idStamp()}`);
  const chunkDirectory = input.chunkDir || (await fs.mkdtemp(path.join(os.tmpdir(), "thalika-voxcpm2-")));
  await fs.mkdir(chunkDirectory, { recursive: true });
  const shouldRemoveChunkDirectory = !input.chunkDir;
  let result: GenerateVoiceResult | undefined;
  let referenceTranscriptEnabled = Boolean(uploadedReferencePath && input.referenceText?.trim());
  let transcriptFallbackUsed = false;

  try {
    const audioChunkPaths: string[] = [];
    const remoteFormats = new Set<string>();
    await appendGenerationLog("generation_started", {
      jobId: input.jobId,
      provider: "voxcpm2",
      characters: input.script.length,
      chunks: chunks.length,
      chunkMaxCharacters,
      mode: uploadedReferencePath ? "voice_cloning" : "voice_design",
      voiceGender: uploadedReferencePath ? "" : input.voiceGender || "auto",
      voicePrompt: uploadedReferencePath ? "" : input.voicePrompt?.trim() || ""
    });
    await input.onProgress?.({
      completedChunks: 0,
      totalChunks: chunks.length,
      message: `Preparing ${chunks.length} audio segment${chunks.length === 1 ? "" : "s"}.`
    });

    for (const [chunkIndex, chunk] of chunks.entries()) {
      await throwIfCancelled();
      const chunkPath = path.join(chunkDirectory, `chunk-${chunkIndex}.wav`);
      if (input.resumeExistingChunks) {
        try {
          await validatePcm24MasterFile(chunkPath);
          audioChunkPaths.push(chunkPath);
          remoteFormats.add("wav");
          await appendGenerationLog("chunk_reused", {
            jobId: input.jobId,
            chunk: chunkIndex + 1,
            chunks: chunks.length,
            chunkPath: path.basename(chunkPath)
          });
          await input.onProgress?.({
            completedChunks: chunkIndex + 1,
            totalChunks: chunks.length,
            message: `Reused generated audio segment ${chunkIndex + 1} of ${chunks.length}.`
          });
          continue;
        } catch {
          await fs.rm(chunkPath, { force: true });
        }
      }

      await appendGenerationLog("chunk_started", {
        jobId: input.jobId,
        chunk: chunkIndex + 1,
        chunks: chunks.length,
        characters: chunk.length
      });
      await input.onProgress?.({
        completedChunks: chunkIndex,
        totalChunks: chunks.length,
        message: `Generating audio segment ${chunkIndex + 1} of ${chunks.length}.`
      });
      const audio = await withRetry(
        async () => {
          let remoteAudioUrl: string;
          try {
            remoteAudioUrl = await callVoxCPM2(
              baseUrl,
              input,
              uploadedReferencePath,
              chunk,
              chunkIndex,
              chunks.length,
              referenceTranscriptEnabled
            );
          } catch (error) {
            if (!referenceTranscriptEnabled || !shouldFallbackFromTranscript(error)) throw error;
            transcriptFallbackUsed = true;
            referenceTranscriptEnabled = false;
            await appendGenerationLog("transcript_mode_fallback", {
              jobId: input.jobId,
              chunk: chunkIndex + 1,
              chunks: chunks.length,
              error: diagnosticError(error)
            });
            remoteAudioUrl = await callVoxCPM2(baseUrl, input, uploadedReferencePath, chunk, chunkIndex, chunks.length, false);
          }
          await throwIfCancelled();
          return downloadRemoteAudio(remoteAudioUrl, input.abortSignal);
        },
        shouldRetryHFError,
        2,
        async (error, attempt) => {
          await appendGenerationLog("chunk_retry", {
            jobId: input.jobId,
            chunk: chunkIndex + 1,
            chunks: chunks.length,
            attempt,
            error: diagnosticError(error)
          });
        }
      );
      let converted;
      try {
        converted = await convertRemoteAudioToPcm24Wav(audio);
      } catch {
        throw new RemoteProviderError("Remote audio decode failed", {
          publicMessage: "VoxCPM2 returned an audio segment that could not be decoded into PCM WAV."
        });
      }
      await throwIfCancelled();
      await fs.writeFile(chunkPath, converted.wav);
      audioChunkPaths.push(chunkPath);
      remoteFormats.add(converted.remoteFormat);
      await appendGenerationLog("chunk_completed", {
        jobId: input.jobId,
        chunk: chunkIndex + 1,
        chunks: chunks.length,
        remoteFormat: converted.remoteFormat,
        remoteBytes: audio.length,
        pcmWavBytes: converted.wav.length
      });
      await input.onProgress?.({
        completedChunks: chunkIndex + 1,
        totalChunks: chunks.length,
        message: `Generated audio segment ${chunkIndex + 1} of ${chunks.length}.`
      });
    }

    await throwIfCancelled();
    const format = "wav";
    const filename = sanitizeFilename(`${outputStem}.wav`);
    const audioFilePath = safeJoin(outputsDir, filename);
    const punctuationAwarePauses = chunks
      .slice(0, -1)
      .map(getPunctuationAwarePauseMilliseconds);
    await appendGenerationLog("merge_started", {
      jobId: input.jobId,
      chunks: chunks.length,
      format,
      encoding: "pcm_s24le",
      pausesMilliseconds: punctuationAwarePauses.join(",")
    });
    await mergeWavFiles(audioChunkPaths, audioFilePath, punctuationAwarePauses);
    await appendGenerationLog("generation_completed", { jobId: input.jobId, chunks: chunks.length, filename, format });
    result = {
      filename,
      audioFilePath,
      format,
      localAudioUrl: `/api/audio/${filename}`,
      metadata: {
        remoteProvider: "huggingface-space",
        remoteBaseUrl: baseUrl,
        remoteFormats: [...remoteFormats].join(","),
        outputEncoding: "pcm_s24le",
        outputSampleRate: 48_000,
        outputChannels: 1,
        outputBitDepth: 24,
        pausePolicy: "punctuation-aware",
        mode: uploadedReferencePath ? "voxcpm2-controllable-cloning" : "voxcpm2-voice-design",
        voiceGender: uploadedReferencePath ? "" : input.voiceGender || "auto",
        voicePrompt: uploadedReferencePath ? "" : input.voicePrompt?.trim() || "",
        cloneMode: input.cloneMode || "high_fidelity",
        cloneStrength: input.cloneStrength ?? 2.8,
        expressiveness: input.expressiveness ?? 0.7,
        prosodyGuidance: expressivenessControl(input.expressiveness),
        denoiseReference: input.denoiseReference ?? false,
        normalizeText: input.normalizeText ?? true,
        referenceTranscriptUsed: Boolean(uploadedReferencePath && input.referenceText?.trim()),
        transcriptFallbackUsed,
        paceGuidance: speedControl(input.speed),
        chunkedGeneration: chunks.length > 1,
        chunkCount: chunks.length,
        chunkMaxCharacters,
        originalCharacters: input.script.length,
        timeoutMs: getHFRequestTimeout(),
        inferenceTimeoutMs: getHFInferenceTimeout()
      }
    };
  } catch (error) {
    await appendGenerationLog("generation_failed", {
      jobId: input.jobId,
      chunks: chunks.length,
      error: diagnosticError(error),
      publicMessage: normalizeVoxCPM2Error(error)
    });
    throw error;
  } finally {
    if (result || shouldRemoveChunkDirectory) {
      await fs.rm(chunkDirectory, { recursive: true, force: true });
    }
  }

  if (!result) throw new Error("VoxCPM2 generation completed without a local audio result.");
  return result;
}

export const voxcpm2Provider: TTSProvider = {
  id: "voxcpm2",
  name: "VoxCPM2",
  async generate(input) {
    try {
      return await generateRemote(input);
    } catch (error) {
      throw new RemoteProviderError("VoxCPM2 remote inference failed", {
        publicMessage: normalizeVoxCPM2Error(error)
      });
    }
  }
};
