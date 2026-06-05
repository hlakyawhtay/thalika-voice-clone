import { detectScriptLanguage } from "./language-utils";
import type { GenerateVoiceRequest, ProviderCapability, ProviderPreflightResult, VoiceProvider } from "./types";

export const providerCapabilities: Record<VoiceProvider, ProviderCapability> = {
  voxcpm2: {
    provider: "voxcpm2",
    name: "VoxCPM2 Multilingual",
    inference: "remote_hf",
    cloneQuality: "production",
    privacy: "remote_public",
    statusLabel: "remote public",
    supportedLanguages: [
      "my",
      "zh",
      "en",
      "ja",
      "ko",
      "de",
      "fr",
      "ru",
      "pt",
      "es",
      "it",
      "mixed_supported"
    ],
    supportedLanguageLabels: [
      "Burmese / Myanmar",
      "Chinese",
      "English",
      "Japanese",
      "Korean",
      "German",
      "French",
      "Russian",
      "Portuguese",
      "Spanish",
      "Italian",
      "and other VoxCPM2-supported languages"
    ],
    requiresReferenceAudio: false,
    canCloneVoice: true,
    limitations: [
      "Direct VoxCPM2 engine access for supported multilingual scripts.",
      "Can generate a requested voice from control instructions without reference audio.",
      "Highest-fidelity cloning still needs clean reference audio and stable Burmese text."
    ],
    recommendation: "Use without reference audio for voice design, or add clean reference audio for cloning."
  },
  burmese_production: {
    provider: "burmese_production",
    name: "Burmese Production",
    inference: "remote_hf",
    cloneQuality: "production",
    privacy: "remote_public",
    statusLabel: "remote public",
    supportedLanguages: ["my"],
    supportedLanguageLabels: ["Burmese / Myanmar"],
    requiresReferenceAudio: true,
    canCloneVoice: true,
    limitations: [
      "Burmese-only production preset over the shared VoxCPM2 remote engine.",
      "A single short upload can attempt voice cloning, but larger consented datasets improve speaker similarity.",
      "Production approval still needs listening tests for similarity, pronunciation, noise, and naturalness."
    ],
    recommendation: "Use this default preset for Burmese scripts plus clean reference audio. Review the generated output before production use."
  }
};

export function preflightProvider(
  input: Pick<GenerateVoiceRequest, "provider" | "script" | "referenceAudio" | "voiceProfileId" | "referenceText" | "normalizationApproved" | "cloneMode">
): ProviderPreflightResult {
  const capability = providerCapabilities[input.provider];
  const detectedLanguage = detectScriptLanguage(input.script);

  if (!input.script.trim()) {
    return {
      ok: false,
      severity: "blocked",
      detectedLanguage,
      message: "Paste a script to analyze language and provider fit.",
      nextStep: "Add the script first, then the studio will decide whether this provider can handle it."
    };
  }

  if (!capability) {
    return {
      ok: false,
      severity: "blocked",
      detectedLanguage,
      message: "Unknown provider.",
      nextStep: "Choose a configured provider."
    };
  }

  if (capability.provider === "voxcpm2") {
    if (!capability.supportedLanguages.includes(detectedLanguage.code)) {
      return {
        ok: false,
        severity: "blocked",
        detectedLanguage,
        message: "VoxCPM2 does not confidently support this detected script language.",
        nextStep: "Use Burmese or another VoxCPM2-supported language, or confirm the script language manually in a future language selector."
      };
    }

    return {
      ok: true,
      severity: "info",
      detectedLanguage,
      message: input.referenceAudio || input.voiceProfileId
        ? "VoxCPM2 model selected for voice cloning."
        : "VoxCPM2 model selected for voice design without cloning.",
      nextStep: "",
      hideNextStep: true
    };
  }

  if (capability.provider === "burmese_production" && detectedLanguage.code !== "my") {
    return {
      ok: false,
      severity: "blocked",
      detectedLanguage,
      message: "Burmese Production mode is for Burmese scripts only.",
      nextStep: "Paste Burmese/Myanmar script text or choose another provider."
    };
  }

  if (!capability.supportedLanguages.includes(detectedLanguage.code)) {
    return {
      ok: false,
      severity: "blocked",
      detectedLanguage,
      message: `${capability.name} does not support ${detectedLanguage.label}.`,
      nextStep:
        detectedLanguage.code === "my"
          ? "Use a Burmese-capable provider track such as MMS-TTS Burmese plus voice conversion, or fine-tune a Burmese voice model."
          : "Choose a provider that supports this script language."
    };
  }

  if (capability.requiresReferenceAudio && !input.referenceAudio && !input.voiceProfileId) {
    return {
      ok: false,
      severity: "blocked",
      detectedLanguage,
      message: `${capability.name} requires reference audio.`,
      nextStep:
        capability.provider === "burmese_production"
          ? "Upload clean Burmese voice data. A short sample can be inspected, but production cloning needs a larger consented dataset."
          : "Upload a clean 3-10 second voice sample."
    };
  }

  if (capability.provider === "burmese_production") {
    if ((input.cloneMode || "high_fidelity") === "high_fidelity" && !input.referenceText?.trim()) {
      return {
        ok: false,
        severity: "blocked",
        detectedLanguage,
        message: "Burmese Production high-fidelity mode requires the exact reference transcript.",
        nextStep: "Paste the words spoken in the uploaded reference audio."
      };
    }
    if (!input.normalizationApproved) {
      return {
        ok: false,
        severity: "blocked",
        detectedLanguage,
        message: "Review and approve the normalized Burmese script before generation.",
        nextStep: "Check the pronunciation preview and approve it."
      };
    }
    return {
      ok: true,
      severity: "info",
      detectedLanguage,
      message: "Burmese Production is the Burmese-only preset powered by VoxCPM2 remote inference.",
      nextStep: "Generate with clean reference audio, then check speaker similarity and Burmese pronunciation."
    };
  }

  return {
    ok: true,
    severity: "warning",
    detectedLanguage,
    message: `${capability.name} can attempt this request, but quality is demo-grade on the public Space.`,
    nextStep: "Use clean reference audio and evaluate speaker similarity before trusting the output."
  };
}
