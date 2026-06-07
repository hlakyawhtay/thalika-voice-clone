"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { KeyRound, Loader2, Save, Sparkles } from "lucide-react";
import { StudioPageShell } from "@/components/StudioPageShell";
import { VoiceSettings, type ProviderHealth } from "@/components/VoiceSettings";
import { analyzeReferenceAudio } from "@/lib/browser-reference-audio";
import { GEMINI_REWRITE_MODELS, type GeminiRewriteModel } from "@/lib/script-rewrite";
import type {
  CloneMode,
  ReferenceAudioPayload,
  ReferenceQualityReport,
  VoiceEmotion,
  VoiceGender,
  VoiceProfileSummary,
  VoiceProvider
} from "@/lib/types";

type SaveState = "idle" | "saving" | "saved" | "failed";
type KeySaveStatus = "idle" | "saving" | "saved" | "failed";

interface StudioSettingsResponse {
  settings: {
    rewriteModel: GeminiRewriteModel;
    keepBurmese: boolean;
    provider: VoiceProvider;
    speed: number;
    emotion: VoiceEmotion;
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
  };
}

interface GeminiSettingsResponse {
  configured: boolean;
  maskedKey: string;
}

const voiceDesignPrompts: Record<VoiceGender, string> = {
  auto: "A warm clear Burmese audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, studio-quality narration",
  male: "A warm mature Burmese male audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, expressive but not dramatic, studio-quality narration",
  female: "A warm mature Burmese female audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, studio-quality narration"
};

const maxKeepaliveBodyBytes = 60 * 1024;

export default function SettingsPage() {
  const [rewriteModel, setRewriteModel] = useState<GeminiRewriteModel>("gemini-3.5-flash");
  const [keepBurmese, setKeepBurmese] = useState(true);
  const [provider, setProvider] = useState<VoiceProvider>("burmese_production");
  const [speed, setSpeed] = useState(1);
  const [emotion, setEmotion] = useState<VoiceEmotion>("calm");
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("auto");
  const [voicePrompt, setVoicePrompt] = useState(voiceDesignPrompts.auto);
  const [cloneMode, setCloneMode] = useState<CloneMode>("high_fidelity");
  const [cloneStrength, setCloneStrength] = useState(2.8);
  const [denoiseReference, setDenoiseReference] = useState(false);
  const [normalizeText, setNormalizeText] = useState(true);
  const [referenceAudio, setReferenceAudio] = useState<ReferenceAudioPayload | undefined>();
  const [referenceAudioError, setReferenceAudioError] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [referenceQualityReport, setReferenceQualityReport] = useState<ReferenceQualityReport | undefined>();
  const [profiles, setProfiles] = useState<VoiceProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [providerHealth, setProviderHealth] = useState<ProviderHealth | undefined>();
  const [providerHealthLoading, setProviderHealthLoading] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [maskedGeminiKey, setMaskedGeminiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [keySaveStatus, setKeySaveStatus] = useState<KeySaveStatus>("idle");
  const [keyError, setKeyError] = useState("");
  const saveAbortRef = useRef<AbortController | null>(null);
  const latestSettingsPayloadRef = useRef<Record<string, unknown> | null>(null);
  const settingsReadyRef = useRef(false);

  const settingsPayload = useMemo(
    () => ({
      rewriteModel,
      keepBurmese,
      provider,
      speed,
      emotion,
      voiceGender,
      voicePrompt,
      cloneMode,
      cloneStrength,
      denoiseReference,
      normalizeText,
      referenceAudio: referenceAudio || null,
      referenceText,
      referenceQualityReport: referenceQualityReport || null,
      selectedProfileId
    }),
    [
      cloneMode,
      cloneStrength,
      denoiseReference,
      emotion,
      keepBurmese,
      normalizeText,
      provider,
      referenceAudio,
      referenceQualityReport,
      referenceText,
      rewriteModel,
      selectedProfileId,
      speed,
      voiceGender,
      voicePrompt
    ]
  );

  useEffect(() => {
    settingsReadyRef.current = settingsReady;
    if (settingsReady) latestSettingsPayloadRef.current = settingsPayload;
  }, [settingsPayload, settingsReady]);

  const loadProfiles = useCallback(async () => {
    const response = await fetch("/api/voice-profiles", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { profiles: VoiceProfileSummary[] };
    setProfiles(data.profiles);
  }, []);

  const loadGeminiSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/settings/gemini", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as GeminiSettingsResponse;
      setGeminiConfigured(data.configured);
      setMaskedGeminiKey(data.maskedKey || "");
    } catch {
      setGeminiConfigured(false);
      setMaskedGeminiKey("");
    }
  }, []);

  const refreshProviderHealth = useCallback(async () => {
    setProviderHealthLoading(true);
    try {
      const response = await fetch("/api/providers/voxcpm2/health", { cache: "no-store" });
      const data = (await response.json()) as ProviderHealth;
      setProviderHealth(data);
    } catch {
      setProviderHealth({
        ok: false,
        status: "unavailable",
        message: "Could not reach the local VoxCPM2 health route.",
        checkedAt: new Date().toISOString()
      });
    } finally {
      setProviderHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    async function loadSettings() {
      const response = await fetch("/api/settings/studio", { cache: "no-store" });
      if (response.ok) {
        const data = (await response.json()) as StudioSettingsResponse;
        setRewriteModel(data.settings.rewriteModel);
        setKeepBurmese(data.settings.keepBurmese);
        setProvider(data.settings.provider);
        setSpeed(data.settings.speed);
        setEmotion(data.settings.emotion);
        setVoiceGender(data.settings.voiceGender);
        setVoicePrompt(data.settings.voicePrompt);
        setCloneMode(data.settings.cloneMode);
        setCloneStrength(data.settings.cloneStrength);
        setDenoiseReference(data.settings.denoiseReference);
        setNormalizeText(data.settings.normalizeText);
        setReferenceAudio(data.settings.referenceAudio);
        setReferenceText(data.settings.referenceText);
        setReferenceQualityReport(data.settings.referenceQualityReport);
        setSelectedProfileId(data.settings.selectedProfileId);
      }
      setSettingsReady(true);
    }

    void loadSettings();
    void loadProfiles();
    void loadGeminiSettings();
  }, [loadGeminiSettings, loadProfiles]);

  useEffect(() => {
    if (provider !== "voxcpm2" && provider !== "burmese_production") {
      setProviderHealth(undefined);
      return;
    }
    void refreshProviderHealth();
  }, [provider, refreshProviderHealth]);

  useEffect(() => {
    if (!settingsReady) return;
    const timeout = window.setTimeout(async () => {
      saveAbortRef.current?.abort();
      const controller = new AbortController();
      saveAbortRef.current = controller;
      setSaveState("saving");
      setSaveError("");
      try {
        const response = await fetch("/api/settings/studio", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settingsPayload),
          signal: controller.signal
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Could not save settings.");
        setSaveState("saved");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setSaveState("failed");
        setSaveError(error instanceof Error ? error.message : "Could not save settings.");
      }
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [settingsPayload, settingsReady]);

  useEffect(() => {
    return () => {
      if (!settingsReadyRef.current) return;
      const payload = latestSettingsPayloadRef.current;
      if (!payload) return;
      const body = JSON.stringify(payload);
      const blob = new Blob([body], { type: "application/json" });
      if (blob.size > maxKeepaliveBodyBytes) return;
      if (navigator.sendBeacon) {
        if (navigator.sendBeacon("/api/settings/studio", blob)) return;
      }
      void fetch("/api/settings/studio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      }).catch(() => undefined);
    };
  }, []);

  async function handleReferenceAudioChange(file: File | null) {
    setSelectedProfileId("");
    setReferenceAudio(undefined);
    setReferenceQualityReport(undefined);
    setReferenceText("");
    setReferenceAudioError("");

    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      setReferenceAudioError("Reference audio must be an audio file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setReferenceAudioError("Reference audio must be 10MB or smaller.");
      return;
    }

    try {
      const report = await analyzeReferenceAudio(file);
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read reference audio."));
        reader.readAsDataURL(file);
      });
      setReferenceAudio({
        dataUrl,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
        durationSeconds: report.durationSeconds
      });
      setReferenceQualityReport(report);
    } catch (caught) {
      setReferenceAudioError(caught instanceof Error ? caught.message : "Could not read reference audio.");
    }
  }

  function selectProfile(id: string) {
    setSelectedProfileId(id);
    setReferenceAudio(undefined);
    setReferenceAudioError("");
    const profile = profiles.find((item) => item.id === id);
    setReferenceText(profile?.referenceText || "");
    setReferenceQualityReport(profile?.qualityReport);
    if (profile) {
      setCloneMode(profile.preferredCloneMode);
      setCloneStrength(profile.preferredCloneStrength);
      setDenoiseReference(profile.preferredDenoiseReference);
      setNormalizeText(profile.preferredNormalizeText);
    }
  }

  function handleVoiceGenderChange(value: VoiceGender) {
    setVoiceGender(value);
    setVoicePrompt(voiceDesignPrompts[value]);
  }

  async function saveProfile(name: string, consent: boolean) {
    if (!referenceAudio || !referenceQualityReport) return;
    const response = await fetch("/api/voice-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        consent,
        referenceAudio,
        referenceText,
        qualityReport: referenceQualityReport,
        preferredCloneMode: cloneMode,
        preferredCloneStrength: cloneStrength,
        preferredDenoiseReference: denoiseReference,
        preferredNormalizeText: normalizeText
      })
    });
    const data = await response.json();
    if (!response.ok) {
      setReferenceAudioError(data.error || "Could not save local voice profile.");
      return;
    }
    const profile = data.profile as VoiceProfileSummary;
    setProfiles((items) => [profile, ...items.filter((item) => item.id !== profile.id)]);
    setSelectedProfileId(profile.id);
    setReferenceAudio(undefined);
  }

  async function deleteProfile() {
    if (!selectedProfileId || !window.confirm("Delete this local voice profile and its saved reference audio?")) return;
    await fetch(`/api/voice-profiles/${encodeURIComponent(selectedProfileId)}`, { method: "DELETE" });
    setSelectedProfileId("");
    setReferenceText("");
    setReferenceQualityReport(undefined);
    await loadProfiles();
  }

  async function saveGeminiApiKey() {
    setKeySaveStatus("saving");
    setKeyError("");

    try {
      const response = await fetch("/api/settings/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: geminiApiKey })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save Gemini API key.");
      setGeminiApiKey("");
      setGeminiConfigured(Boolean(data.configured));
      setMaskedGeminiKey(data.maskedKey || "");
      setKeySaveStatus("saved");
      window.setTimeout(() => setKeySaveStatus("idle"), 900);
    } catch (caught) {
      setKeySaveStatus("failed");
      setKeyError(caught instanceof Error ? caught.message : "Could not save Gemini API key.");
    }
  }

  const referenceRequirementError =
    provider === "burmese_production"
      ? referenceAudioError ||
        (!referenceAudio && !selectedProfileId
          ? "Burmese production cloning requires clean reference voice data."
          : referenceAudio?.durationSeconds && referenceAudio.durationSeconds < 3
            ? "Reference audio is too short. Use at least 3 seconds, ideally 6-15 seconds."
            : referenceAudio?.durationSeconds && referenceAudio.durationSeconds > 50
              ? "Reference audio is too long for VoxCPM2. Trim it to 6-30 seconds of clean speech."
              : "")
      : referenceAudioError;

  return (
    <StudioPageShell
      activeTab="settings"
      badge="Saved studio defaults"
      title="Settings"
      description="Rewrite and voice defaults are saved locally and used by the Script queue."
      aside={
        <span className="w-fit rounded-md border border-studio-border bg-white px-3 py-2 text-sm font-medium text-studio-text">
          {saveState === "saving" ? "Saving" : saveState === "saved" ? "Saved" : saveState === "failed" ? "Save failed" : "Ready"}
        </span>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(360px,1.15fr)]">
        <section className="studio-card-bg rounded-xl border border-studio-border p-5">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-studio-accent/10 text-studio-accent">
              <Sparkles size={19} />
            </div>
            <h2 className="text-lg font-semibold text-studio-text">Rewrite Settings</h2>
          </div>

          <div className="grid gap-4">
            <div className="studio-soft-chip-bg flex items-center justify-between gap-3 rounded-lg border border-studio-border px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-studio-muted">
                <KeyRound size={15} />
                Gemini API
              </span>
              <span className={geminiConfigured ? "font-semibold text-studio-success" : "font-semibold text-studio-amber"}>
                {geminiConfigured ? `Configured ${maskedGeminiKey}` : "Not configured"}
              </span>
            </div>

            <label className="grid gap-2 text-sm font-medium text-studio-muted">
              Gemini model
              <select
                value={rewriteModel}
                onChange={(event) => setRewriteModel(event.target.value as GeminiRewriteModel)}
                className="studio-control-bg rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent"
              >
                {GEMINI_REWRITE_MODELS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="studio-control-bg flex items-center justify-between gap-3 rounded-lg border border-studio-border px-3 py-3 text-sm font-medium text-studio-muted">
              <span>Keep Burmese language</span>
              <input
                type="checkbox"
                checked={keepBurmese}
                onChange={(event) => setKeepBurmese(event.target.checked)}
                className="h-4 w-4 accent-studio-accent"
              />
            </label>

            <label className="grid gap-2 text-sm font-medium text-studio-muted">
              API key
              <input
                type="password"
                value={geminiApiKey}
                onChange={(event) => setGeminiApiKey(event.target.value)}
                placeholder="Paste your Gemini API key"
                className="studio-control-bg rounded-lg border border-studio-border px-4 py-3 text-studio-text outline-none transition focus:border-studio-accent"
              />
            </label>

            {keyError && <p className="text-sm font-medium text-red-600">{keyError}</p>}
            <button
              type="button"
              disabled={!geminiApiKey.trim() || keySaveStatus === "saving"}
              onClick={saveGeminiApiKey}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-studio-accent px-5 py-3 font-semibold text-studio-text transition hover:bg-studio-accent/85 disabled:cursor-not-allowed disabled:bg-studio-border disabled:text-studio-muted"
            >
              {keySaveStatus === "saving" ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
              {keySaveStatus === "saved" ? "Saved" : keySaveStatus === "saving" ? "Saving..." : "Save API Key"}
            </button>
          </div>
          {saveError && <p className="mt-4 text-sm text-red-600">{saveError}</p>}
        </section>

        <VoiceSettings
          provider={provider}
          speed={speed}
          emotion={emotion}
          voiceGender={voiceGender}
          voicePrompt={voicePrompt}
          cloneMode={cloneMode}
          cloneStrength={cloneStrength}
          denoiseReference={denoiseReference}
          normalizeText={normalizeText}
          referenceAudio={referenceAudio}
          referenceText={referenceText}
          referenceQualityReport={referenceQualityReport}
          profiles={profiles}
          selectedProfileId={selectedProfileId}
          referenceAudioError={referenceRequirementError}
          providerHealth={providerHealth}
          providerHealthLoading={providerHealthLoading}
          onProviderChange={setProvider}
          onSpeedChange={setSpeed}
          onEmotionChange={setEmotion}
          onVoiceGenderChange={handleVoiceGenderChange}
          onVoicePromptChange={setVoicePrompt}
          onCloneModeChange={setCloneMode}
          onCloneStrengthChange={setCloneStrength}
          onDenoiseReferenceChange={setDenoiseReference}
          onNormalizeTextChange={setNormalizeText}
          onReferenceAudioChange={handleReferenceAudioChange}
          onReferenceTextChange={setReferenceText}
          onProfileSelect={selectProfile}
          onProfileSave={(name, consent) => void saveProfile(name, consent)}
          onProfileDelete={() => void deleteProfile()}
          onLexiconSaved={() => undefined}
          onRefreshProviderHealth={refreshProviderHealth}
        />
      </div>
    </StudioPageShell>
  );
}
