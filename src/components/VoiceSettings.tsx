"use client";

import { Gauge, Mic2, Pause, Play, Plus, RefreshCw, Save, Server, Settings, SlidersHorizontal, Trash2, UploadCloud, Wand2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { assessReferenceAudio } from "@/lib/reference-audio-quality";
import type { BurmeseLexiconEntry, CloneMode, ReferenceAudioPayload, ReferenceQualityReport, VoiceEmotion, VoiceGender, VoiceProfileSummary, VoiceProvider } from "@/lib/types";

export type ProviderHealthStatus =
  | "connected"
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "invalid_response"
  | "misconfigured";

export interface ProviderHealth {
  ok: boolean;
  status: ProviderHealthStatus;
  message: string;
  latencyMs?: number;
  checkedAt?: string;
}

interface VoiceSettingsProps {
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
  profiles: VoiceProfileSummary[];
  selectedProfileId?: string;
  referenceAudioError?: string;
  providerHealth?: ProviderHealth;
  providerHealthLoading?: boolean;
  onProviderChange: (value: VoiceProvider) => void;
  onSpeedChange: (value: number) => void;
  onEmotionChange: (value: VoiceEmotion) => void;
  onExpressivenessChange: (value: number) => void;
  onVoiceGenderChange: (value: VoiceGender) => void;
  onVoicePromptChange: (value: string) => void;
  onCloneModeChange: (value: CloneMode) => void;
  onCloneStrengthChange: (value: number) => void;
  onDenoiseReferenceChange: (value: boolean) => void;
  onNormalizeTextChange: (value: boolean) => void;
  onReferenceAudioChange: (file: File | null) => void;
  onReferenceTextChange: (value: string) => void;
  onProfileSelect: (id: string) => void;
  onProfileSave: (name: string, consent: boolean) => void;
  onProfileDelete: () => void;
  onLexiconSaved: () => void;
  onRefreshProviderHealth?: () => void;
}

const healthLabel: Record<ProviderHealthStatus, string> = {
  connected: "HF connected",
  timeout: "HF timeout",
  rate_limited: "HF rate limited",
  unavailable: "HF unavailable",
  invalid_response: "HF invalid response",
  misconfigured: "HF not configured"
};

const healthClassName: Record<ProviderHealthStatus, string> = {
  connected: "border-studio-success/45 bg-studio-successBg text-studio-success",
  timeout: "border-studio-amber/45 bg-studio-warningBg text-studio-amber",
  rate_limited: "border-studio-amber/45 bg-studio-warningBg text-studio-amber",
  unavailable: "border-red-300/50 bg-red-50 text-red-700",
  invalid_response: "border-red-300/50 bg-red-50 text-red-700",
  misconfigured: "border-red-300/50 bg-red-50 text-red-700"
};

export function VoiceSettings({
  provider,
  speed,
  emotion,
  expressiveness,
  voiceGender,
  voicePrompt,
  cloneMode,
  cloneStrength,
  denoiseReference,
  normalizeText,
  referenceAudio,
  referenceText,
  referenceQualityReport,
  profiles,
  selectedProfileId,
  referenceAudioError,
  providerHealth,
  providerHealthLoading = false,
  onProviderChange,
  onSpeedChange,
  onEmotionChange,
  onExpressivenessChange,
  onVoiceGenderChange,
  onVoicePromptChange,
  onCloneModeChange,
  onCloneStrengthChange,
  onDenoiseReferenceChange,
  onNormalizeTextChange,
  onReferenceAudioChange,
  onReferenceTextChange,
  onProfileSelect,
  onProfileSave,
  onProfileDelete,
  onLexiconSaved,
  onRefreshProviderHealth
}: VoiceSettingsProps) {
  const referenceAssessment = assessReferenceAudio(referenceAudio);
  const isCloneProvider = provider === "voxcpm2" || provider === "burmese_production";
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId);
  const [profileName, setProfileName] = useState("");
  const [profileConsent, setProfileConsent] = useState(false);
  const [lexiconOpen, setLexiconOpen] = useState(false);
  const [lexiconEntries, setLexiconEntries] = useState<BurmeseLexiconEntry[]>([]);
  const [lexiconError, setLexiconError] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewAudioSrc, setPreviewAudioSrc] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewPlaying, setPreviewPlaying] = useState(false);

  useEffect(() => {
    if (!lexiconOpen) return;
    void fetch("/api/settings/burmese-lexicon", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setLexiconEntries(data.entries || []))
      .catch(() => setLexiconError("Could not load the Burmese lexicon."));
  }, [lexiconOpen]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    setPreviewAudioSrc("");
    setPreviewLoading(false);
    setPreviewError("");
    setPreviewPlaying(false);
  }, [referenceAudio, selectedProfileId]);

  async function toggleReferencePreview() {
    const audio = audioRef.current;
    if (!audio) return;

    if (previewPlaying) {
      audio.pause();
      setPreviewPlaying(false);
      return;
    }

    setPreviewError("");
    let audioSrc = referenceAudio?.dataUrl || previewAudioSrc;

    try {
      if (!audioSrc && selectedProfileId) {
        setPreviewLoading(true);
        const response = await fetch(`/api/voice-profiles/${encodeURIComponent(selectedProfileId)}`, { cache: "no-store" });
        const data = (await response.json()) as { referenceAudio?: ReferenceAudioPayload; error?: string };
        if (!response.ok || !data.referenceAudio?.dataUrl) throw new Error(data.error || "Could not load voice profile audio.");
        audioSrc = data.referenceAudio.dataUrl;
        setPreviewAudioSrc(audioSrc);
      }

      if (!audioSrc) throw new Error("Choose a reference audio file or saved profile first.");
      audio.src = audioSrc;
      await audio.play();
      setPreviewPlaying(true);
    } catch (caught) {
      setPreviewError(caught instanceof Error ? caught.message : "Could not play reference audio.");
      setPreviewPlaying(false);
    } finally {
      setPreviewLoading(false);
    }
  }

  async function saveLexicon() {
    setLexiconError("");
    const response = await fetch("/api/settings/burmese-lexicon", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: lexiconEntries })
    });
    const data = await response.json();
    if (!response.ok) {
      setLexiconError(data.error || "Could not save the Burmese lexicon.");
      return;
    }
    setLexiconOpen(false);
    onLexiconSaved();
  }

  return (
    <section className="studio-card-bg rounded-xl border border-studio-border p-5">
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-studio-accent/10 text-studio-accent">
          <SlidersHorizontal size={19} />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-studio-text">Voice Settings</h2>
        </div>
      </div>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-2 text-sm font-medium text-studio-muted">
          Provider
          <select
            value={provider}
            onChange={(event) => onProviderChange(event.target.value as VoiceProvider)}
            className="studio-control-bg rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent"
          >
            <option value="burmese_production">Burmese Production (recommended)</option>
            <option value="voxcpm2">VoxCPM2 Multilingual</option>
          </select>
          {/* <p className="text-xs leading-relaxed text-studio-muted">
            {provider === "burmese_production"
              ? "Recommended for Burmese scripts. Uses the shared VoxCPM2 engine with Burmese-only validation."
              : "Direct VoxCPM2 engine access for supported multilingual scripts."}
          </p> */}
        </label>

        {isCloneProvider && (
          <div className="studio-nested-card-bg grid gap-3 rounded-xl border border-studio-border p-4">
            <div className="flex flex-wrap items-center gap-2">
              {provider === "voxcpm2" ? (
                <>
                  <span className="inline-flex items-center gap-2 rounded-md border border-studio-accent/30 bg-studio-accent/10 px-3 py-1 text-xs font-semibold text-studio-success">
                    <Mic2 size={13} /> VoxCPM2 multilingual inference
                  </span>
                  <span className="rounded-md border border-studio-amber/45 bg-studio-warningBg px-3 py-1 text-xs font-semibold text-studio-amber">
                    Public shared inference may be slow
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-2 rounded-md border border-studio-accent/30 bg-studio-accent/10 px-3 py-1 text-xs font-semibold text-studio-success">
                    <Mic2 size={13} /> Burmese production preset
                  </span>
                  <span className="rounded-md border border-studio-amber/45 bg-studio-warningBg px-3 py-1 text-xs font-semibold text-studio-amber">
                    Powered by VoxCPM2 remote inference
                  </span>
                </>
              )}
            </div>

            <div className="studio-control-bg grid gap-2 rounded-lg border border-studio-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-semibold text-studio-text">
                  <Server size={15} /> HF backend
                </span>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-md border px-3 py-1 text-xs font-semibold ${providerHealth
                        ? healthClassName[providerHealth.status]
                        : "border-slate-300 bg-slate-100 text-slate-600"
                      }`}
                  >
                    {providerHealthLoading ? "Checking..." : providerHealth ? healthLabel[providerHealth.status] : "Not checked"}
                  </span>
                  {onRefreshProviderHealth && (
                    <button
                      type="button"
                      onClick={onRefreshProviderHealth}
                      disabled={providerHealthLoading}
                      className="grid h-8 w-8 place-items-center rounded-md border border-studio-border bg-white/35 text-studio-muted transition hover:text-studio-text disabled:opacity-50"
                      aria-label="Refresh VoxCPM2 backend health"
                    >
                      <RefreshCw size={14} className={providerHealthLoading ? "animate-spin" : ""} />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs leading-relaxed text-studio-muted">
                {providerHealth?.message || "Checks the public Hugging Face Space before remote generation."}
                {providerHealth?.latencyMs !== undefined && providerHealth.latencyMs > 0
                  ? ` ${providerHealth.latencyMs}ms.`
                  : ""}
              </p>
            </div>

            <label className="grid gap-2 text-sm font-medium text-studio-muted">
              Saved voice profile
              <select value={selectedProfileId || ""} onChange={(event) => onProfileSelect(event.target.value)} className="studio-control-bg rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent">
                <option value="">Use a new upload</option>
                {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>

            <label className="grid gap-2 text-sm font-medium text-studio-muted">
              <span className="inline-flex items-center gap-2"><UploadCloud size={15} /> Reference audio {provider === "voxcpm2" ? "(optional)" : ""}</span>
              <input
                type="file"
                accept="audio/*"
                onChange={(event) => onReferenceAudioChange(event.target.files?.[0] || null)}
                className="studio-control-bg block w-full rounded-lg border border-studio-border px-3 py-3 text-sm text-studio-text file:mr-3 file:rounded-xl file:border-0 file:bg-studio-accent file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-950"
              />
            </label>
            <p className={referenceAudioError ? "text-sm text-red-600" : "text-sm text-studio-muted"}>
              {referenceAudioError ||
                (referenceAudio
                  ? `${referenceAudio.filename} (${Math.ceil(referenceAudio.size / 1024)} KB${referenceAudio.durationSeconds ? `, ${referenceAudio.durationSeconds.toFixed(1)}s` : ""
                  })`
                  : selectedProfileId
                    ? "Saved local voice profile selected."
                    : provider === "voxcpm2"
                      ? "Leave empty for requested voice design, or upload a clean voice reference for cloning."
                      : provider === "burmese_production"
                        ? "Upload clean Burmese voice data. This will run through the VoxCPM2 backend."
                        : "Upload a 3-10 second audio sample for the remote Space.")}
            </p>
            {(referenceAudio || selectedProfileId) && (
              <div className="studio-control-bg flex flex-wrap items-center justify-between gap-3 rounded-lg border border-studio-border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-studio-text">Reference preview</p>
                  <p className="truncate text-xs text-studio-muted">
                    {referenceAudio?.filename || selectedProfile?.referenceFilename || "Selected voice profile"}
                  </p>
                  {previewError && <p className="mt-1 text-xs text-red-600">{previewError}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void toggleReferencePreview()}
                  disabled={previewLoading}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-studio-border px-3 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent disabled:opacity-50"
                  aria-label={previewPlaying ? "Pause reference audio preview" : "Play reference audio preview"}
                >
                  {previewLoading ? <RefreshCw size={15} className="animate-spin" /> : previewPlaying ? <Pause size={15} /> : <Play size={15} />}
                  {previewPlaying ? "Pause" : "Play"}
                </button>
                <audio
                  ref={audioRef}
                  preload="none"
                  onEnded={() => setPreviewPlaying(false)}
                  onPause={() => setPreviewPlaying(false)}
                  onPlay={() => setPreviewPlaying(true)}
                  className="hidden"
                />
              </div>
            )}

            {provider === "voxcpm2" && !referenceAudio && !selectedProfileId && (
              <div className="grid gap-3">
                <label className="grid gap-2 text-sm font-medium text-studio-muted">
                  Default voice
                  <select
                    value={voiceGender}
                    onChange={(event) => onVoiceGenderChange(event.target.value as VoiceGender)}
                    className="studio-control-bg rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent"
                  >
                    <option value="auto">Auto</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </label>
                <label className="grid gap-2 text-sm font-medium text-studio-muted">
                  Voice request
                  <textarea
                    value={voicePrompt}
                    onChange={(event) => onVoicePromptChange(event.target.value)}
                    maxLength={500}
                    placeholder="e.g. A warm mature Burmese audiobook narrator with clear Myanmar pronunciation"
                    className="studio-control-bg min-h-24 rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent"
                  />
                  <span className="text-xs leading-5">Used when no reference audio is selected.</span>
                </label>
              </div>
            )}

            {(referenceAudio || selectedProfileId) && (
              <div className="studio-control-bg grid gap-2 rounded-lg border border-studio-border p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-medium text-studio-muted"><Gauge size={15} /> Reference quality</span>
                  <span className="font-semibold text-studio-text">{referenceQualityReport?.score ?? referenceAssessment.score}/100</span>
                </div>
                <div className="h-2 overflow-hidden rounded-md bg-studio-border">
                  <div className="h-full rounded-md bg-studio-accent" style={{ width: `${referenceQualityReport?.score ?? referenceAssessment.score}%` }} />
                </div>
                <p className="text-xs text-studio-muted">
                  {referenceQualityReport ? `${referenceQualityReport.status.toUpperCase()} · ${referenceQualityReport.issues.join(" ") || "Clean reference audio."}` : referenceAssessment.message}
                </p>
              </div>
            )}

            <label className="grid gap-2 text-sm font-medium text-studio-muted">
              Exact reference transcript {provider === "voxcpm2" ? "(only for cloning)" : ""}
              <textarea value={referenceText} onChange={(event) => onReferenceTextChange(event.target.value)} maxLength={2000} placeholder="Paste the exact words spoken in the reference audio..." className="studio-control-bg min-h-24 rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent" />
              <span className="text-xs leading-5">Required for Burmese high-fidelity cloning. The transcript is sent with the reference audio to improve similarity.</span>
            </label>

            {referenceAudio && !selectedProfileId && (
              <div className="studio-control-bg grid gap-2 rounded-lg border border-studio-border p-3">
                <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Optional local profile name" className="rounded-xl border border-studio-border bg-white/60 px-3 py-2 text-sm text-studio-text outline-none" />
                <label className="flex items-start gap-2 text-xs leading-5 text-studio-muted">
                  <input type="checkbox" checked={profileConsent} onChange={(event) => setProfileConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-studio-accent" />
                  Save this consented voice sample and transcript on this device for repeated use.
                </label>
                <button type="button" disabled={!profileName.trim() || !profileConsent || !referenceText.trim() || referenceQualityReport?.status === "block"} onClick={() => onProfileSave(profileName, profileConsent)} className="inline-flex items-center justify-center gap-2 rounded-xl bg-studio-accent px-3 py-2 text-sm font-semibold text-studio-text disabled:opacity-45">
                  <Save size={15} /> Save Local Profile
                </button>
              </div>
            )}
            {selectedProfileId && (
              <button type="button" onClick={onProfileDelete} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm font-semibold text-red-600">
                <Trash2 size={15} /> Delete Selected Profile
              </button>
            )}
          </div>
        )}

        {isCloneProvider && (
          <details className="studio-nested-card-bg rounded-xl border border-studio-border p-4">
            <summary className="cursor-pointer text-sm font-semibold text-studio-text">Advanced tuning</summary>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm font-medium text-studio-muted">
                <span className="inline-flex items-center gap-2"><Wand2 size={15} /> Clone mode</span>
                <select
                  value={cloneMode}
                  onChange={(event) => onCloneModeChange(event.target.value as CloneMode)}
                  className="studio-control-bg rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent"
                >
                  <option value="high_fidelity">high fidelity</option>
                  <option value="balanced">balanced</option>
                </select>
              </label>

              <label className="grid gap-3 text-sm font-medium text-studio-muted">
                <span className="flex justify-between">
                  Clone strength <span className="text-studio-text">{cloneStrength.toFixed(1)}</span>
                </span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  value={cloneStrength}
                  onChange={(event) => onCloneStrengthChange(Number(event.target.value))}
                  className="accent-studio-accent"
                />
              </label>

              <div className="grid gap-3 text-sm text-studio-muted">
                <label className="studio-control-bg flex items-center justify-between gap-3 rounded-lg border border-studio-border px-3 py-2">
                  <span>Reference denoise</span>
                  <input
                    type="checkbox"
                    checked={denoiseReference}
                    onChange={(event) => onDenoiseReferenceChange(event.target.checked)}
                    className="h-4 w-4 accent-studio-accent"
                  />
                </label>
                <label className="studio-control-bg flex items-center justify-between gap-3 rounded-lg border border-studio-border px-3 py-2">
                  <span>Text normalization</span>
                  <input
                    type="checkbox"
                    checked={normalizeText}
                    onChange={(event) => onNormalizeTextChange(event.target.checked)}
                    className="h-4 w-4 accent-studio-accent"
                  />
                </label>
                <label className="grid gap-3 text-sm font-medium text-studio-muted px-3 py-2">
                  <span className="flex justify-between">
                    Speed <span className="text-studio-text">{speed.toFixed(1)}x</span>
                  </span>
                  <input
                    type="range"
                    min="0.8"
                    max="1.2"
                    step="0.1"
                    value={speed}
                    onChange={(event) => onSpeedChange(Number(event.target.value))}
                    className="accent-studio-accent"
                  />
                  <span className="text-xs leading-5">Public VoxCPM2 uses this as pace guidance, not an exact playback-speed transform.</span>
                </label>
                <label className="grid gap-3 text-sm font-medium text-studio-muted px-3 py-2">
                  <span className="flex justify-between">
                    Expressiveness <span className="text-studio-text">{Math.round(expressiveness * 100)}%</span>
                  </span>
                  <input
                    type="range"
                    min="0.2"
                    max="1"
                    step="0.1"
                    value={expressiveness}
                    onChange={(event) => onExpressivenessChange(Number(event.target.value))}
                    className="accent-studio-accent"
                  />
                  <span className="text-xs leading-5">Adds stronger Burmese pitch rise/fall, phrase emphasis, and sentence-ending movement.</span>
                </label>
              </div>
            </div>
          </details>
        )}



        <label className="grid gap-2 text-sm font-medium text-studio-muted">
          Emotion
          <select
            value={emotion}
            onChange={(event) => onEmotionChange(event.target.value as VoiceEmotion)}
            className="studio-control-bg rounded-lg border border-studio-border px-3 py-3 text-studio-text outline-none focus:border-studio-accent"
          >
            <option value="neutral">neutral</option>
            <option value="calm">calm</option>
            <option value="energetic">energetic</option>
            <option value="dramatic">dramatic</option>
          </select>
        </label>
      </div>

      {provider === "burmese_production" && (
        <button type="button" onClick={() => setLexiconOpen(true)} className="studio-soft-chip-bg mt-4 inline-flex items-center gap-2 rounded-md border border-studio-border px-3 py-2 text-xs font-semibold text-studio-text">
          <Settings size={14} /> Burmese Pronunciation Lexicon
        </button>
      )}

      {lexiconOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" className="studio-card-bg max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-studio-border p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold text-studio-text">Burmese Pronunciation Lexicon</h2><p className="text-sm text-studio-muted">Local replacements for names, brands, and loanwords.</p></div>
              <button type="button" onClick={() => setLexiconOpen(false)} aria-label="Close lexicon" className="grid h-9 w-9 place-items-center rounded-xl border border-studio-border text-studio-muted"><X size={16} /></button>
            </div>
            <div className="grid gap-2">
              {lexiconEntries.map((entry, index) => (
                <div key={`lexicon-entry-${index}`} className="studio-control-bg grid gap-2 rounded-lg border border-studio-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <input value={entry.source} onChange={(event) => setLexiconEntries((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value } : item))} placeholder="Source" className="rounded-xl border border-studio-border px-2 py-2 text-sm text-studio-text outline-none focus:border-studio-accent" />
                  <input value={entry.spoken} onChange={(event) => setLexiconEntries((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, spoken: event.target.value } : item))} placeholder="Spoken form" className="rounded-xl border border-studio-border px-2 py-2 text-sm text-studio-text outline-none focus:border-studio-accent" />
                  <input value={entry.note || ""} onChange={(event) => setLexiconEntries((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, note: event.target.value } : item))} placeholder="Note" className="rounded-xl border border-studio-border px-2 py-2 text-sm text-studio-text outline-none focus:border-studio-accent" />
                  <button type="button" onClick={() => setLexiconEntries((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Delete lexicon entry" className="grid h-9 w-9 place-items-center rounded-xl border border-red-200 text-red-600"><Trash2 size={15} /></button>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setLexiconEntries((items) => [...items, { source: "", spoken: "", note: "" }])} className="inline-flex items-center gap-2 rounded-xl border border-studio-border px-3 py-2 text-sm font-semibold text-studio-text"><Plus size={15} /> Add Entry</button>
              <button type="button" onClick={() => void saveLexicon()} className="inline-flex items-center gap-2 rounded-xl bg-studio-accent px-4 py-2 text-sm font-semibold text-studio-text"><Save size={15} /> Save Lexicon</button>
            </div>
            {lexiconError && <p className="mt-3 text-sm text-red-600">{lexiconError}</p>}
          </section>
        </div>
      )}
    </section>
  );
}
