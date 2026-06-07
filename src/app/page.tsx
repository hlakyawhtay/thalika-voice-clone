"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AudioPreview } from "@/components/AudioPreview";
import { GenerateButton } from "@/components/GenerateButton";
import { ScriptInput } from "@/components/ScriptInput";
import { StatusPanel, type StudioStatus } from "@/components/StatusPanel";
import { StudioPageShell } from "@/components/StudioPageShell";
import { VoiceSettings, type ProviderHealth } from "@/components/VoiceSettings";
import { NormalizationApprovalPanel } from "@/components/NormalizationApprovalPanel";
import { analyzeReferenceAudio } from "@/lib/browser-reference-audio";
import { preflightProvider } from "@/lib/provider-capabilities";
import type {
  CloneMode,
  ProviderPreflightResult,
  BurmeseNormalizationResult,
  ReferenceAudioPayload,
  ReferenceQualityReport,
  VoiceProfileSummary,
  VoiceEmotion,
  VoiceGender,
  VoiceProvider,
  JobRecord
} from "@/lib/types";

interface AudioResult {
  audioUrl: string;
  filename: string;
  provider: string;
  createdAt: string;
}

interface GenerationProgressState {
  jobId: string;
  completedChunks: number;
  totalChunks: number;
  message: string;
}

interface VoiceOverDraft {
  title?: string;
  script?: string;
  provider?: VoiceProvider;
  speed?: number;
  emotion?: VoiceEmotion;
  expressiveness?: number;
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
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

const voiceDesignPrompts: Record<VoiceGender, string> = {
  auto: "A warm clear Burmese audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, studio-quality narration",
  male: "A warm mature Burmese male audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, expressive but not dramatic, studio-quality narration",
  female: "A warm mature Burmese female audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, expressive but not dramatic, studio-quality narration"
};

const activeGenerationJobStorageKey = "thalika.activeGenerationJobId";

function readActiveGenerationJobId() {
  try {
    return window.localStorage.getItem(activeGenerationJobStorageKey);
  } catch {
    return null;
  }
}

function saveActiveGenerationJobId(jobId: string) {
  try {
    window.localStorage.setItem(activeGenerationJobStorageKey, jobId);
  } catch {
    // Progress still works for the current mounted page without localStorage.
  }
}

function clearActiveGenerationJobId(jobId?: string) {
  try {
    const activeJobId = window.localStorage.getItem(activeGenerationJobStorageKey);
    if (!jobId || activeJobId === jobId) {
      window.localStorage.removeItem(activeGenerationJobStorageKey);
    }
  } catch {
    // Nothing to clear if browser storage is unavailable.
  }
}

export default function Home() {
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [provider, setProvider] = useState<VoiceProvider>("burmese_production");
  const [speed, setSpeed] = useState(1);
  const [emotion, setEmotion] = useState<VoiceEmotion>("calm");
  const [expressiveness, setExpressiveness] = useState(0.7);
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("auto");
  const [voicePrompt, setVoicePrompt] = useState(voiceDesignPrompts.auto);
  const [cloneMode, setCloneMode] = useState<CloneMode>("high_fidelity");
  const [cloneStrength, setCloneStrength] = useState(2.8);
  const [denoiseReference, setDenoiseReference] = useState(false);
  const [normalizeText, setNormalizeText] = useState(true);
  const [status, setStatus] = useState<StudioStatus>("idle");
  const [error, setError] = useState("");
  const [audioResult, setAudioResult] = useState<AudioResult | undefined>();
  const [generationProgress, setGenerationProgress] = useState<GenerationProgressState | undefined>();
  const [referenceAudio, setReferenceAudio] = useState<ReferenceAudioPayload | undefined>();
  const [referenceAudioError, setReferenceAudioError] = useState("");
  const [referenceText, setReferenceText] = useState("");
  const [referenceQualityReport, setReferenceQualityReport] = useState<ReferenceQualityReport | undefined>();
  const [profiles, setProfiles] = useState<VoiceProfileSummary[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [normalization, setNormalization] = useState<BurmeseNormalizationResult | undefined>();
  const [normalizationLoading, setNormalizationLoading] = useState(false);
  const [normalizationApproved, setNormalizationApproved] = useState(false);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth | undefined>();
  const [providerHealthLoading, setProviderHealthLoading] = useState(false);
  const [jobActionLoading, setJobActionLoading] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const loadedDraftRef = useRef(false);
  const activePollRef = useRef(0);
  const latestDraftPayloadRef = useRef<Record<string, unknown> | null>(null);
  const normalizationRef = useRef<BurmeseNormalizationResult | undefined>(undefined);
  const normalizationApprovedRef = useRef(false);

  useEffect(() => {
    return () => {
      activePollRef.current += 1;
    };
  }, []);

  useEffect(() => {
    normalizationRef.current = normalization;
  }, [normalization]);

  useEffect(() => {
    normalizationApprovedRef.current = normalizationApproved;
  }, [normalizationApproved]);

  useEffect(() => {
    const activeJobId = readActiveGenerationJobId();
    if (!activeJobId) return;

    const pollToken = activePollRef.current + 1;
    activePollRef.current = pollToken;
    setStatus("generating");
    setError("");
    setGenerationProgress({
      jobId: activeJobId,
      completedChunks: 0,
      totalChunks: 0,
      message: "Checking active generation job."
    });
    void pollGenerationJob(activeJobId, pollToken);
  }, []);

  useEffect(() => {
    async function loadDraft() {
      try {
        const response = await fetch("/api/drafts/voice-over", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { draft: VoiceOverDraft | null };
        if (!data.draft) return;
        if (data.draft.title) setTitle(data.draft.title);
        setScript(data.draft.script || "");
        if (data.draft.provider) setProvider(data.draft.provider);
        if (data.draft.speed) setSpeed(data.draft.speed);
        if (data.draft.emotion) setEmotion(data.draft.emotion);
        if (data.draft.expressiveness) setExpressiveness(data.draft.expressiveness);
        if (data.draft.voiceGender) setVoiceGender(data.draft.voiceGender);
        if (data.draft.voicePrompt !== undefined) setVoicePrompt(data.draft.voicePrompt || voiceDesignPrompts[data.draft.voiceGender || "auto"]);
        if (data.draft.cloneMode) setCloneMode(data.draft.cloneMode);
        if (data.draft.cloneStrength) setCloneStrength(data.draft.cloneStrength);
        if (data.draft.denoiseReference !== undefined) setDenoiseReference(data.draft.denoiseReference);
        if (data.draft.normalizeText !== undefined) setNormalizeText(data.draft.normalizeText);
        if (data.draft.referenceAudio) setReferenceAudio(data.draft.referenceAudio);
        if (data.draft.referenceText !== undefined) setReferenceText(data.draft.referenceText);
        if (data.draft.referenceQualityReport) setReferenceQualityReport(data.draft.referenceQualityReport);
        if (data.draft.selectedProfileId) setSelectedProfileId(data.draft.selectedProfileId);
        if (data.draft.normalization) setNormalization(data.draft.normalization);
        if (data.draft.normalizationApproved !== undefined) setNormalizationApproved(data.draft.normalizationApproved);
        loadedDraftRef.current = true;
      } catch {
        // Draft transfer is optional; voice generation still works without it.
      } finally {
        setDraftReady(true);
      }
    }

    void loadDraft();
  }, []);

  const loadProfiles = useCallback(async () => {
    const response = await fetch("/api/voice-profiles", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { profiles: VoiceProfileSummary[] };
    setProfiles(data.profiles);
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  const refreshNormalization = useCallback(async () => {
    if (provider !== "burmese_production" || script.trim().length < 10) {
      setNormalization(undefined);
      setNormalizationApproved(false);
      return;
    }
    setNormalizationLoading(true);
    setNormalizationApproved(false);
    try {
      const response = await fetch("/api/burmese/normalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script })
      });
      if (!response.ok) throw new Error("Could not prepare Burmese pronunciation preview.");
      const result = (await response.json()) as BurmeseNormalizationResult;
      const previousNormalization = normalizationRef.current;
      setNormalizationApproved(
        Boolean(
          normalizationApprovedRef.current &&
            previousNormalization?.normalizedScript === result.normalizedScript &&
            previousNormalization.lexiconRevision === result.lexiconRevision
        )
      );
      setNormalization(result);
    } catch {
      setNormalization(undefined);
    } finally {
      setNormalizationLoading(false);
    }
  }, [provider, script]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshNormalization(), 450);
    return () => window.clearTimeout(timer);
  }, [refreshNormalization]);

  const draftPayload = useMemo(
    () => ({
      title,
      script,
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
      referenceAudio: referenceAudio || null,
      referenceText,
      referenceQualityReport: referenceQualityReport || null,
      selectedProfileId,
      normalization: normalization || null,
      normalizationApproved
    }),
    [
      cloneMode,
      cloneStrength,
      denoiseReference,
      emotion,
      expressiveness,
      normalizeText,
      normalization,
      normalizationApproved,
      provider,
      referenceAudio,
      referenceQualityReport,
      referenceText,
      script,
      selectedProfileId,
      speed,
      title,
      voiceGender,
      voicePrompt
    ]
  );

  useEffect(() => {
    latestDraftPayloadRef.current = draftPayload;
  }, [draftPayload]);

  useEffect(() => {
    return () => {
      const payload = latestDraftPayloadRef.current;
      if (!payload) return;
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        if (navigator.sendBeacon("/api/drafts/voice-over", blob)) return;
      }
      void fetch("/api/drafts/voice-over", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true
      });
    };
  }, []);

  useEffect(() => {
    if (!draftReady) return;

    const timeout = window.setTimeout(() => {
      void fetch("/api/drafts/voice-over", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftPayload)
      });
      loadedDraftRef.current = false;
    }, loadedDraftRef.current ? 1200 : 600);

    return () => window.clearTimeout(timeout);
  }, [draftPayload, draftReady]);

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
    if (provider !== "voxcpm2" && provider !== "burmese_production") {
      setProviderHealth(undefined);
      return;
    }

    void refreshProviderHealth();
  }, [provider, refreshProviderHealth]);

  const scriptError = useMemo(() => {
    const trimmed = script.trim();
    if (!trimmed) return "Script is required.";
    if (trimmed.length < 10) return "Script must be at least 10 characters.";
    return "";
  }, [script]);

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

  async function pollGenerationJob(jobId: string, pollToken: number) {
    try {
      while (activePollRef.current === pollToken) {
        const response = await fetch(`/api/history/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const data = (await response.json()) as { job?: JobRecord; audioUrl?: string; error?: string };
        if (!response.ok || !data.job) {
          throw new Error(data.error || "Could not read generation progress.");
        }

        const job = data.job;
        setGenerationProgress({
          jobId,
          completedChunks: job.completedChunks || 0,
          totalChunks: job.totalChunks || 0,
          message: job.progressMessage || job.content || "Generating audio."
        });

        if (job.status === "completed") {
          if (!job.audioFile || !data.audioUrl) {
            throw new Error("Generation completed without an audio file.");
          }
          clearActiveGenerationJobId(jobId);
          setAudioResult({
            audioUrl: data.audioUrl,
            filename: job.audioFile,
            provider: job.provider,
            createdAt: job.createdAt
          });
          setStatus("completed");
          return;
        }

        if (job.status === "failed") {
          clearActiveGenerationJobId(jobId);
          throw new Error(job.error || "Generation failed");
        }

        if (job.status === "canceled") {
          clearActiveGenerationJobId(jobId);
          setError(job.error || "Generation canceled.");
          setStatus("canceled");
          return;
        }

        await wait(2000);
      }
    } catch (caught) {
      if (activePollRef.current !== pollToken) return;
      setError(caught instanceof Error ? caught.message : "Generation failed");
      setStatus("failed");
    }
  }

  async function generateAudio() {
    const preflight = preflightProvider({ provider, script, referenceAudio, voiceProfileId: selectedProfileId || undefined, referenceText, normalizationApproved, cloneMode });
    if (scriptError || !preflight.ok) {
      setError(preflight.message);
      setStatus("failed");
      return;
    }
    const pollToken = activePollRef.current + 1;
    activePollRef.current = pollToken;
    setStatus("saving");
    setError("");
    setAudioResult(undefined);
    setGenerationProgress(undefined);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          script,
          provider,
          format: "wav",
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
          voiceProfileId: selectedProfileId || undefined,
          referenceQualityReport,
          approvedNormalizedScript: normalization?.normalizedScript,
          lexiconRevision: normalization?.lexiconRevision,
          normalizationApproved
        })
      });
      const data = await response.json();

      if (!response.ok || data.status === "failed") {
        throw new Error(data.message || data.error || "Generation failed");
      }

      setStatus("generating");
      setGenerationProgress({
        jobId: data.jobId,
        completedChunks: 0,
        totalChunks: 0,
        message: data.progressMessage || "Preparing audio generation."
      });
      saveActiveGenerationJobId(data.jobId);
      void pollGenerationJob(data.jobId, pollToken);
    } catch (caught) {
      if (activePollRef.current === pollToken) activePollRef.current += 1;
      setError(caught instanceof Error ? caught.message : "Generation failed");
      setStatus("failed");
    }
  }

  async function cancelGeneration() {
    const jobId = generationProgress?.jobId;
    if (!jobId || jobActionLoading) return;

    setJobActionLoading(true);
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not cancel generation.");
      activePollRef.current += 1;
      clearActiveGenerationJobId(jobId);
      setError("Generation canceled.");
      setStatus("canceled");
      setGenerationProgress((progress) =>
        progress
          ? {
              ...progress,
              message: "Generation canceled."
            }
          : progress
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel generation.");
    } finally {
      setJobActionLoading(false);
    }
  }

  async function retryGeneration() {
    const jobId = generationProgress?.jobId;
    if (!jobId || jobActionLoading) return;

    const pollToken = activePollRef.current + 1;
    activePollRef.current = pollToken;
    setJobActionLoading(true);
    setError("");

    try {
      const response = await fetch(`/api/history/${encodeURIComponent(jobId)}/retry`, { method: "POST" });
      const data = await response.json();
      if (!response.ok || data.status === "failed") throw new Error(data.message || data.error || "Could not retry generation.");
      setStatus("generating");
      setGenerationProgress({
        jobId: data.jobId,
        completedChunks: generationProgress?.completedChunks || 0,
        totalChunks: generationProgress?.totalChunks || 0,
        message: data.progressMessage || "Resuming audio generation."
      });
      saveActiveGenerationJobId(data.jobId);
      void pollGenerationJob(data.jobId, pollToken);
    } catch (caught) {
      if (activePollRef.current === pollToken) activePollRef.current += 1;
      setError(caught instanceof Error ? caught.message : "Could not retry generation.");
      setStatus("failed");
    } finally {
      setJobActionLoading(false);
    }
  }

  const isGenerating = status === "saving" || status === "generating";
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
      : provider === "voxcpm2"
        ? referenceAudioError ||
          (referenceAudio?.durationSeconds && referenceAudio.durationSeconds < 3
              ? "Reference audio is too short. Use at least 3 seconds, ideally 6-15 seconds."
              : referenceAudio?.durationSeconds && referenceAudio.durationSeconds > 50
                ? "Reference audio is too long for VoxCPM2. Trim it to 6-30 seconds of clean speech."
                : "")
      : referenceAudioError;
  const generateDisabled =
    Boolean(scriptError) ||
    isGenerating ||
    (provider === "burmese_production" &&
      ((!referenceAudio && !selectedProfileId) || Boolean(referenceRequirementError))) ||
    (provider === "voxcpm2" && Boolean(referenceRequirementError)) ||
    (provider === "burmese_production" && (referenceQualityReport?.status === "block" || !referenceText.trim() || !normalizationApproved));
  const activePreflight: ProviderPreflightResult = preflightProvider({ provider, script, referenceAudio, voiceProfileId: selectedProfileId || undefined, referenceText, normalizationApproved, cloneMode });
  const capabilityDisabled = !activePreflight.ok;
  const disabledReason =
    scriptError ||
    referenceRequirementError ||
    (referenceQualityReport?.status === "block" ? "Reference audio quality is blocked. Upload a cleaner voice sample." : "") ||
    (!activePreflight.ok ? activePreflight.message : "");

  const heroAside = (
    <span className="w-fit rounded-md bg-studio-warningBg px-3 py-2 font-mono text-xs font-bold text-studio-amber">
      VoxCPM2 - Active
    </span>
  );

  return (
    <StudioPageShell
      activeTab="voiceover"
      badge="Local-first voice generation"
      title="Voice Over Studio"
      description="Generate local high-fidelity speech synthesis from scripts."
      aside={heroAside}
    >
        {status !== "idle" && (
          <div className="sticky top-3 z-20 px-3 pt-3 sm:px-5">
            <StatusPanel
              status={status}
              error={error}
              progressMessage={generationProgress?.message}
              completedChunks={generationProgress?.completedChunks}
              totalChunks={generationProgress?.totalChunks}
              variant="dock"
              actionLoading={jobActionLoading}
              onCancel={status === "generating" ? () => void cancelGeneration() : undefined}
              onRetry={generationProgress?.jobId && (status === "failed" || status === "canceled") ? () => void retryGeneration() : undefined}
            />
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.48fr)]">
          <div className="grid gap-5">
            <ScriptInput
              title={title}
              script={script}
              error={scriptError}
              onTitleChange={setTitle}
              onScriptChange={setScript}
            />
            {provider === "burmese_production" && (
              <NormalizationApprovalPanel result={normalization} loading={normalizationLoading} approved={normalizationApproved} onRefresh={() => void refreshNormalization()} onApprove={() => setNormalizationApproved(true)} />
            )}
          </div>

          <aside className="grid content-start gap-5">
            <VoiceSettings
              provider={provider}
              speed={speed}
              emotion={emotion}
              expressiveness={expressiveness}
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
              onExpressivenessChange={setExpressiveness}
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
              onLexiconSaved={() => void refreshNormalization()}
              onRefreshProviderHealth={refreshProviderHealth}
            />
            <GenerateButton
              disabled={generateDisabled || capabilityDisabled}
              loading={isGenerating}
              disabledReason={disabledReason}
              onClick={generateAudio}
            />
            <AudioPreview result={audioResult} />
          </aside>
        </div>
    </StudioPageShell>
  );
}
