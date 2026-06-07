import fs from "node:fs/promises";
import path from "node:path";
import { ensureDataDirs, memoryFile } from "../file-utils";
import type {
  CloneMode,
  ReferenceAudioPayload,
  ReferenceQualityReport,
  VoiceEmotion,
  VoiceGender,
  VoiceProvider
} from "../types";
import type { GeminiRewriteModel } from "../script-rewrite";

const studioSettingsFile = path.join(path.dirname(memoryFile), "studio-settings.json");

export interface StudioSettings {
  rewriteModel: GeminiRewriteModel;
  keepBurmese: boolean;
  provider: VoiceProvider;
  speed: number;
  emotion: VoiceEmotion;
  expressiveness: number;
  voiceGender: VoiceGender;
  voicePrompt: string;
  cloneMode: CloneMode;
  cloneStrength: number;
  denoiseReference: boolean;
  normalizeText: boolean;
  referenceAudio?: ReferenceAudioPayload;
  referenceText: string;
  referenceQualityReport?: ReferenceQualityReport;
  selectedProfileId: string;
  updatedAt: string;
}

export const defaultStudioSettings: StudioSettings = {
  rewriteModel: "gemini-3.5-flash",
  keepBurmese: true,
  provider: "burmese_production",
  speed: 1,
  emotion: "calm",
  expressiveness: 0.7,
  voiceGender: "auto",
  voicePrompt:
    "A warm clear Burmese audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, studio-quality narration",
  cloneMode: "high_fidelity",
  cloneStrength: 2.8,
  denoiseReference: false,
  normalizeText: true,
  referenceText: "",
  selectedProfileId: "",
  updatedAt: new Date(0).toISOString()
};

export async function readStudioSettings() {
  await ensureDataDirs();
  try {
    const raw = await fs.readFile(studioSettingsFile, "utf8");
    return { ...defaultStudioSettings, ...(JSON.parse(raw) as Partial<StudioSettings>) } satisfies StudioSettings;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return defaultStudioSettings;
    }
    throw error;
  }
}

type StudioSettingsInput = Partial<Omit<StudioSettings, "updatedAt" | "referenceAudio" | "referenceQualityReport">> & {
  referenceAudio?: ReferenceAudioPayload | null;
  referenceQualityReport?: ReferenceQualityReport | null;
};

export async function saveStudioSettings(input: StudioSettingsInput) {
  await ensureDataDirs();
  const previous = await readStudioSettings();
  const settings: StudioSettings = {
    ...previous,
    ...input,
    referenceAudio: input.referenceAudio === null ? undefined : input.referenceAudio ?? previous.referenceAudio,
    referenceQualityReport:
      input.referenceQualityReport === null ? undefined : input.referenceQualityReport ?? previous.referenceQualityReport,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(studioSettingsFile, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settings;
}
