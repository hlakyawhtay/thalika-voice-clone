import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataDirs, memoryFile } from "../file-utils";
import type {
  BurmeseNormalizationResult,
  CloneMode,
  ReferenceAudioPayload,
  ReferenceQualityReport,
  VoiceEmotion,
  VoiceGender,
  VoiceProvider
} from "../types";

const voiceOverDraftFile = path.join(path.dirname(memoryFile), "voice-over-draft.json");

export interface VoiceOverDraft {
  title: string;
  script: string;
  provider?: VoiceProvider;
  speed?: number;
  emotion?: VoiceEmotion;
  voiceGender?: VoiceGender;
  voicePrompt?: string;
  cloneMode?: CloneMode;
  cloneStrength?: number;
  denoiseReference?: boolean;
  normalizeText?: boolean;
  referenceAudio?: ReferenceAudioPayload;
  referenceText?: string;
  referenceQualityReport?: ReferenceQualityReport;
  selectedProfileId?: string;
  normalization?: BurmeseNormalizationResult;
  normalizationApproved?: boolean;
  createdAt: string;
  updatedAt?: string;
}

type VoiceOverDraftInput = Partial<
  Omit<VoiceOverDraft, "createdAt" | "updatedAt" | "referenceAudio" | "referenceQualityReport" | "normalization">
> & {
  script?: string;
  referenceAudio?: ReferenceAudioPayload | null;
  referenceQualityReport?: ReferenceQualityReport | null;
  normalization?: BurmeseNormalizationResult | null;
};

function hasOwn<T extends object>(input: T, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export async function saveVoiceOverDraft(input: VoiceOverDraftInput) {
  await ensureDataDirs();
  const previous = await readVoiceOverDraft();
  const draft: VoiceOverDraft = {
    title: hasOwn(input, "title") ? input.title?.trim() || "Narration Rewrite" : previous?.title || "Narration Rewrite",
    script: hasOwn(input, "script") ? input.script?.trim() || "" : previous?.script || "",
    provider: hasOwn(input, "provider") ? input.provider : previous?.provider,
    speed: hasOwn(input, "speed") ? input.speed : previous?.speed,
    emotion: hasOwn(input, "emotion") ? input.emotion : previous?.emotion,
    voiceGender: hasOwn(input, "voiceGender") ? input.voiceGender : previous?.voiceGender,
    voicePrompt: hasOwn(input, "voicePrompt") ? input.voicePrompt : previous?.voicePrompt,
    cloneMode: hasOwn(input, "cloneMode") ? input.cloneMode : previous?.cloneMode,
    cloneStrength: hasOwn(input, "cloneStrength") ? input.cloneStrength : previous?.cloneStrength,
    denoiseReference: hasOwn(input, "denoiseReference") ? input.denoiseReference : previous?.denoiseReference,
    normalizeText: hasOwn(input, "normalizeText") ? input.normalizeText : previous?.normalizeText,
    referenceAudio: hasOwn(input, "referenceAudio") ? input.referenceAudio || undefined : previous?.referenceAudio,
    referenceText: hasOwn(input, "referenceText") ? input.referenceText : previous?.referenceText,
    referenceQualityReport: hasOwn(input, "referenceQualityReport") ? input.referenceQualityReport || undefined : previous?.referenceQualityReport,
    selectedProfileId: hasOwn(input, "selectedProfileId") ? input.selectedProfileId : previous?.selectedProfileId,
    normalization: hasOwn(input, "normalization") ? input.normalization || undefined : previous?.normalization,
    normalizationApproved: hasOwn(input, "normalizationApproved") ? input.normalizationApproved : previous?.normalizationApproved,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(voiceOverDraftFile, JSON.stringify(draft, null, 2), "utf8");
  return draft;
}

export async function readVoiceOverDraft() {
  try {
    const raw = await fs.readFile(voiceOverDraftFile, "utf8");
    return JSON.parse(raw) as VoiceOverDraft;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function deleteVoiceOverDraft() {
  try {
    await fs.unlink(voiceOverDraftFile);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
