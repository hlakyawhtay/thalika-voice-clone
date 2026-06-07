"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, CheckSquare, Copy, FilePenLine, Hash, Loader2, Play, Plus, Save, Settings, Sparkles, Trash2, X } from "lucide-react";
import { HistoryAudioPlayer } from "@/components/HistoryPanel";
import { StudioPageShell } from "@/components/StudioPageShell";
import type { ProviderHealth } from "@/components/VoiceSettings";
import { analyzeReferenceAudio } from "@/lib/browser-reference-audio";
import { expandBurmeseNumberTokens } from "@/lib/burmese-number-words";
import { applyBurmeseLexiconEntries } from "@/lib/burmese-normalizer";
import type { GeminiRewriteModel } from "@/lib/script-rewrite";
import type {
  BurmeseLexiconEntry,
  CloneMode,
  ReferenceAudioPayload,
  ReferenceQualityReport,
  ScriptGenerationStatus,
  ScriptRecord,
  VoiceEmotion,
  VoiceGender,
  VoiceProfileSummary,
  VoiceProvider
} from "@/lib/types";

type RewriteStatus = "idle" | "rewriting" | "completed" | "failed";
type KeySaveStatus = "idle" | "saving" | "saved" | "failed";
type SaveStatus = "idle" | "saving" | "saved" | "failed";
type QueueStatus = "idle" | "starting" | "queued" | "failed";

interface RewriteResponse {
  status: "completed" | "failed";
  title?: string;
  rewrittenScript?: string;
  rewrittenCharacterCount?: number;
  originalCharacterCount?: number;
  model?: string;
  error?: string;
  message?: string;
}

interface GeminiSettingsResponse {
  configured: boolean;
  maskedKey: string;
}

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

const statusLabels: Record<RewriteStatus, string> = {
  idle: "Idle",
  rewriting: "Rewriting",
  completed: "Completed",
  failed: "Failed"
};

const generationLabels: Record<ScriptGenerationStatus, string> = {
  idle: "ready",
  queued: "queued",
  generating: "generating",
  completed: "completed",
  failed: "failed"
};

const voiceDesignPrompts: Record<VoiceGender, string> = {
  auto: "A warm clear Burmese audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, studio-quality narration",
  male: "A warm mature Burmese male audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, expressive but not dramatic, studio-quality narration",
  female: "A warm mature Burmese female audiobook narrator voice, natural storytelling, clear Myanmar pronunciation, calm pacing, expressive but not dramatic, studio-quality narration"
};

export default function ScriptPage() {
  const [chapters, setChapters] = useState<ScriptRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState("");
  const [title, setTitle] = useState("");
  const [script, setScript] = useState("");
  const [model, setModel] = useState<GeminiRewriteModel>("gemini-3.5-flash");
  const [keepBurmese, setKeepBurmese] = useState(true);
  const [rewriteStatus, setRewriteStatus] = useState<RewriteStatus>("idle");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [queueStatus, setQueueStatus] = useState<QueueStatus>("idle");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [maskedGeminiKey, setMaskedGeminiKey] = useState("");
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [keySaveStatus, setKeySaveStatus] = useState<KeySaveStatus>("idle");
  const [keyError, setKeyError] = useState("");
  const [lexiconOpen, setLexiconOpen] = useState(false);
  const [lexiconEntries, setLexiconEntries] = useState<BurmeseLexiconEntry[]>([]);
  const [lexiconError, setLexiconError] = useState("");
  const [error, setError] = useState("");
  const [editorTransformMessage, setEditorTransformMessage] = useState("");
  const [queueError, setQueueError] = useState("");

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
  const pollRef = useRef(0);

  const loadChapters = useCallback(async () => {
    const response = await fetch("/api/scripts", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { scripts: ScriptRecord[] };
    setChapters(data.scripts);
    setSelectedIds((current) => new Set([...current].filter((id) => data.scripts.some((chapter) => chapter.id === id))));
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

  const loadStudioSettings = useCallback(async () => {
    const response = await fetch("/api/settings/studio", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as StudioSettingsResponse;
    setModel(data.settings.rewriteModel);
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
  }, []);

  const loadProfiles = useCallback(async () => {
    const response = await fetch("/api/voice-profiles", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { profiles: VoiceProfileSummary[] };
    setProfiles(data.profiles);
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
    void loadChapters();
    void loadGeminiSettings();
    void loadStudioSettings();
  }, [loadChapters, loadGeminiSettings, loadStudioSettings]);

  useEffect(() => {
    if (provider !== "voxcpm2" && provider !== "burmese_production") {
      setProviderHealth(undefined);
      return;
    }
    void refreshProviderHealth();
  }, [provider, refreshProviderHealth]);

  useEffect(() => {
    if (!chapters.some((chapter) => chapter.generationStatus === "queued" || chapter.generationStatus === "generating")) return;
    const token = pollRef.current + 1;
    pollRef.current = token;
    const timer = window.setInterval(() => {
      if (pollRef.current === token) void loadChapters();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [chapters, loadChapters]);

  useEffect(() => {
    if (!lexiconOpen) return;
    void loadLexiconEntries();
  }, [lexiconOpen]);

  const scriptError = useMemo(() => {
    const trimmed = script.trim();
    if (!trimmed) return "Script is required.";
    if (trimmed.length < 10) return "Script must be at least 10 characters.";
    return "";
  }, [script]);

  const queueTargets = useMemo(() => {
    const ids = selectedIds.size ? selectedIds : new Set(chapters.map((chapter) => chapter.id));
    return chapters.filter((chapter) => ids.has(chapter.id));
  }, [chapters, selectedIds]);

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

  const queueDisabledReason =
    queueTargets.length === 0
      ? "Save at least one chapter before queueing."
      : referenceRequirementError ||
        (referenceQualityReport?.status === "block" ? "Reference audio quality is blocked. Upload a cleaner voice sample." : "") ||
        (provider === "burmese_production" && (cloneMode || "high_fidelity") === "high_fidelity" && !referenceText.trim()
          ? "Burmese high-fidelity cloning requires the exact reference transcript."
          : "");
  const queueDisabled = Boolean(queueDisabledReason) || queueStatus === "starting";

  function resetEditor() {
    setEditingId("");
    setTitle("");
    setScript("");
    setRewriteStatus("idle");
    setSaveStatus("idle");
    setError("");
    setEditorTransformMessage("");
  }

  function editChapter(chapter: ScriptRecord) {
    setEditingId(chapter.id);
    setTitle(chapter.title);
    setScript(chapter.content);
    setRewriteStatus("idle");
    setSaveStatus("idle");
    setError("");
    setEditorTransformMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleChapter(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllChapters() {
    setSelectedIds((current) => {
      if (current.size === chapters.length) return new Set();
      return new Set(chapters.map((chapter) => chapter.id));
    });
  }

  async function saveChapter() {
    if (scriptError) {
      setSaveStatus("failed");
      setError(scriptError);
      return;
    }

    setSaveStatus("saving");
    setError("");
    const method = editingId ? "PUT" : "POST";
    const url = editingId ? `/api/scripts/${encodeURIComponent(editingId)}` : "/api/scripts";
    const body = {
      title,
      script,
      order: editingId ? chapters.find((chapter) => chapter.id === editingId)?.order || 0 : chapters.length + 1
    };

    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not save chapter.");
      setSaveStatus("saved");
      setEditingId(data.script.id);
      await loadChapters();
    } catch (caught) {
      setSaveStatus("failed");
      setError(caught instanceof Error ? caught.message : "Could not save chapter.");
    }
  }

  async function deleteChapter(chapter: ScriptRecord) {
    if (!window.confirm(`Delete chapter "${chapter.title}"${chapter.audioFile ? ` and audio file ${chapter.audioFile}` : ""}?`)) return;
    const response = await fetch(`/api/scripts/${encodeURIComponent(chapter.id)}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      window.alert(data.error || "Could not delete chapter.");
      return;
    }
    if (editingId === chapter.id) resetEditor();
    await loadChapters();
  }

  async function rewriteScript() {
    if (scriptError) {
      setRewriteStatus("failed");
      setError(scriptError);
      return;
    }

    setRewriteStatus("rewriting");
    setError("");

    try {
      const response = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, script, model, keepBurmese })
      });
      const data = (await response.json()) as RewriteResponse;
      if (!response.ok || data.status === "failed" || !data.rewrittenScript) {
        throw new Error(data.message || data.error || "Script rewrite failed.");
      }

      setScript(data.rewrittenScript);
      setEditorTransformMessage("");
      setRewriteStatus("completed");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Script rewrite failed.");
      setRewriteStatus("failed");
    }
  }

  function convertNumbersInEditor() {
    if (!script.trim()) {
      setEditorTransformMessage("Paste script text before converting numbers.");
      return;
    }

    const result = expandBurmeseNumberTokens(script);
    setScript(result.normalizedScript);
    setEditorTransformMessage(
      result.changes.length > 0
        ? `Converted ${result.changes.length.toLocaleString()} number${result.changes.length === 1 ? "" : "s"}.`
        : "No standalone whole numbers found."
    );
    setError("");
  }

  async function loadLexiconEntries() {
    setLexiconError("");
    try {
      const response = await fetch("/api/settings/burmese-lexicon", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load wordlist.");
      setLexiconEntries(data.entries || []);
    } catch (caught) {
      setLexiconError(caught instanceof Error ? caught.message : "Could not load wordlist.");
    }
  }

  async function saveLexiconEntries() {
    setLexiconError("");
    const entries = lexiconEntries
      .map((entry) => ({
        source: entry.source.trim(),
        spoken: entry.spoken.trim(),
        note: entry.note?.trim() || ""
      }))
      .filter((entry) => entry.source || entry.spoken);

    try {
      const response = await fetch("/api/settings/burmese-lexicon", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save wordlist.");
      setLexiconEntries(data.entries || entries);
      setLexiconOpen(false);
      setEditorTransformMessage("Wordlist saved.");
    } catch (caught) {
      setLexiconError(caught instanceof Error ? caught.message : "Could not save wordlist.");
    }
  }

  async function applyWordlistInEditor() {
    if (!script.trim()) {
      setEditorTransformMessage("Paste script text before applying the wordlist.");
      return;
    }

    try {
      const response = await fetch("/api/settings/burmese-lexicon", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load wordlist.");
      const entries = (data.entries || []) as BurmeseLexiconEntry[];
      const result = applyBurmeseLexiconEntries(script, entries);
      setScript(result.normalizedScript);
      setEditorTransformMessage(
        result.changes.length > 0
          ? `Applied ${result.changes.length.toLocaleString()} wordlist replacement${result.changes.length === 1 ? "" : "s"}.`
          : "No wordlist matches found."
      );
      setError("");
    } catch (caught) {
      setEditorTransformMessage("");
      setError(caught instanceof Error ? caught.message : "Could not apply wordlist.");
    }
  }

  async function copyEditorScript() {
    if (!script.trim()) return;
    await navigator.clipboard.writeText(script);
  }

  async function queueChapters() {
    if (queueDisabled) {
      setQueueError(queueDisabledReason || "Queue is not ready.");
      setQueueStatus("failed");
      return;
    }

    setQueueStatus("starting");
    setQueueError("");

    try {
      const response = await fetch("/api/scripts/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scriptIds: queueTargets.map((chapter) => chapter.id),
          settings: {
            provider,
            format: "wav",
            speed,
            emotion,
            voiceGender,
            voicePrompt,
            cloneMode,
            cloneStrength,
            denoiseReference,
            normalizeText,
            referenceAudio,
            referenceText,
            voiceProfileId: selectedProfileId || undefined,
            referenceQualityReport
          }
        })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "Could not start chapter queue.");
      setQueueStatus("queued");
      await loadChapters();
    } catch (caught) {
      setQueueStatus("failed");
      setQueueError(caught instanceof Error ? caught.message : "Could not start chapter queue.");
    }
  }

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
      window.setTimeout(() => {
        setSettingsOpen(false);
        setKeySaveStatus("idle");
      }, 700);
    } catch (caught) {
      setKeySaveStatus("failed");
      setKeyError(caught instanceof Error ? caught.message : "Could not save Gemini API key.");
    }
  }

  const heroAside = (
    <div className="flex flex-wrap items-center gap-2">
      <span className="rounded-md border border-studio-success bg-studio-successBg px-3 py-2 font-mono text-xs font-bold text-studio-success">
        Gemini {geminiConfigured ? "Ready" : "Missing Key"}
      </span>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-studio-border bg-white px-3 py-2 text-sm font-medium text-studio-text"
      >
        <Settings size={14} />
        Settings
      </button>
    </div>
  );

  return (
    <StudioPageShell
      activeTab="script"
      badge="Audiobook chapter queue"
      title="Script Rewriter"
      description="Optimize and rewrite Burmese scripts for high-fidelity narration using Gemini AI."
      aside={heroAside}
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <section className="studio-card-bg rounded-xl border border-studio-border p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-studio-accent/10 text-studio-accent">
                <FilePenLine size={19} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-studio-text">{editingId ? "Edit Chapter" : "New Chapter"}</h2>
                <p className="text-sm text-studio-muted">Saved rows are queued as separate audiobook chapters.</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-md border border-studio-border bg-studio-panelSoft px-3 py-1 text-xs text-studio-muted">
              {script.length.toLocaleString()} chars
            </span>
          </div>

          <label className="mb-2 block text-sm font-medium text-studio-muted" htmlFor="chapter-title">
            Chapter title
          </label>
          <input
            id="chapter-title"
            maxLength={150}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Chapter 1"
            className="studio-control-bg mb-4 w-full rounded-lg border border-studio-border px-4 py-3 text-studio-text outline-none transition focus:border-studio-accent"
          />

          <label className="mb-2 block text-sm font-medium text-studio-muted" htmlFor="chapter-script">
            Chapter script
          </label>
          <textarea
            id="chapter-script"
            value={script}
            onChange={(event) => {
              setScript(event.target.value);
              setEditorTransformMessage("");
            }}
            placeholder="Paste or edit this chapter..."
            className="studio-control-bg min-h-[28rem] w-full resize-y rounded-xl border border-studio-border px-4 py-3 leading-7 text-studio-text outline-none transition placeholder:text-studio-muted/60 focus:border-studio-accent"
          />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span className={scriptError ? "text-red-600" : "text-studio-muted"}>
              {scriptError || "Long chapters are saved without a local character ceiling."}
            </span>
            <span className="text-studio-muted">{script.trim().split(/\s+/).filter(Boolean).length.toLocaleString()} words</span>
          </div>

          {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
          {editorTransformMessage && <p className="mt-3 text-sm font-medium text-studio-muted">{editorTransformMessage}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={Boolean(scriptError) || saveStatus === "saving"}
              onClick={saveChapter}
              className="inline-flex items-center gap-2 rounded-md bg-studio-accent px-4 py-2 text-sm font-semibold text-studio-text transition hover:bg-studio-accent/85 disabled:cursor-not-allowed disabled:bg-studio-border disabled:text-studio-muted"
            >
              {saveStatus === "saving" ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {saveStatus === "saved" ? "Saved" : editingId ? "Save Edit" : "Save Chapter"}
            </button>
            <button
              type="button"
              disabled={Boolean(scriptError) || rewriteStatus === "rewriting"}
              onClick={rewriteScript}
              className="studio-soft-chip-bg inline-flex items-center gap-2 rounded-md border border-studio-border px-4 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rewriteStatus === "rewriting" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              {rewriteStatus === "rewriting" ? "Rewriting..." : "Rewrite Editor"}
            </button>
            <button
              type="button"
              disabled={!script.trim()}
              onClick={convertNumbersInEditor}
              className="studio-soft-chip-bg inline-flex items-center gap-2 rounded-md border border-studio-border px-4 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Hash size={16} />
              Convert Numbers
            </button>
            <button
              type="button"
              disabled={!script.trim()}
              onClick={() => void applyWordlistInEditor()}
              className="studio-soft-chip-bg inline-flex items-center gap-2 rounded-md border border-studio-border px-4 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles size={16} />
              Apply Wordlist
            </button>
            <button
              type="button"
              onClick={() => setLexiconOpen(true)}
              className="studio-soft-chip-bg inline-flex items-center gap-2 rounded-md border border-studio-border px-4 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent"
            >
              <Settings size={16} />
              Wordlist
            </button>
            <button
              type="button"
              disabled={!script.trim()}
              onClick={copyEditorScript}
              className="studio-soft-chip-bg inline-flex items-center gap-2 rounded-md border border-studio-border px-4 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Copy size={16} />
              Copy
            </button>
            <button
              type="button"
              onClick={resetEditor}
              className="studio-soft-chip-bg inline-flex items-center gap-2 rounded-md border border-studio-border px-4 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent"
            >
              <Plus size={16} />
              New
            </button>
          </div>
        </section>

        <aside className="grid content-start gap-5">
          <section className="studio-card-bg rounded-xl border border-studio-border p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-studio-accent/10 text-studio-accent">
                  {rewriteStatus === "rewriting" ? <Loader2 size={19} className="animate-spin" /> : <CheckCircle2 size={19} />}
                </div>
                <h2 className="text-lg font-semibold text-studio-text">Rewrite Status</h2>
              </div>
              <span
                className={`rounded-md px-3 py-1 text-xs font-semibold ${
                  rewriteStatus === "completed"
                    ? "bg-studio-successBg text-studio-success"
                    : rewriteStatus === "failed"
                      ? "bg-red-50 text-red-700"
                      : "bg-studio-border text-studio-muted"
                }`}
              >
                {statusLabels[rewriteStatus]}
              </span>
            </div>
            <p className="mt-3 text-sm text-studio-muted">
              {rewriteStatus === "idle" && "Waiting for editor text."}
              {rewriteStatus === "rewriting" && "Sending chapter chunks to Gemini."}
              {rewriteStatus === "completed" && "Rewrite replaced the editor text. Save the chapter to keep it."}
              {rewriteStatus === "failed" && (error || "Rewrite failed.")}
            </p>
          </section>
        </aside>

        <section className="studio-card-bg rounded-xl border border-studio-border p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-studio-accent/10 text-studio-accent">
                <CheckSquare size={19} />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-studio-text">Saved Chapters</h2>
                <p className="text-sm text-studio-muted">Selected rows queue first; if none are selected, all chapters queue.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={chapters.length === 0}
                onClick={toggleAllChapters}
                className="studio-soft-chip-bg inline-flex items-center gap-2 rounded-md border border-studio-border px-3 py-2 text-sm font-semibold text-studio-text transition hover:border-studio-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <CheckSquare size={15} />
                {selectedIds.size === chapters.length && chapters.length > 0 ? "Clear" : "Select All"}
              </button>
              <button
                type="button"
                disabled={queueDisabled}
                onClick={queueChapters}
                title={queueDisabledReason || "Start audiobook queue"}
                className="inline-flex items-center gap-2 rounded-md bg-studio-accent px-4 py-2 text-sm font-semibold text-studio-text transition hover:bg-studio-accent/85 disabled:cursor-not-allowed disabled:bg-studio-border disabled:text-studio-muted"
              >
                {queueStatus === "starting" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Queue {queueTargets.length || chapters.length}
              </button>
            </div>
          </div>

          {queueError && <p className="mb-3 text-sm font-medium text-red-600">{queueError}</p>}
          {queueDisabledReason && <p className="mb-3 text-sm text-studio-muted">{queueDisabledReason}</p>}

          <div className="grid gap-3">
            {chapters.length === 0 && <p className="text-sm text-studio-muted">Saved audiobook chapters will appear here.</p>}
            {chapters.map((chapter, index) => {
              const status = chapter.generationStatus || "idle";
              const showProgress = (status === "queued" || status === "generating") && Boolean(chapter.totalChunks);
              const progressPercent = showProgress
                ? Math.min(100, Math.round(((chapter.completedChunks || 0) / (chapter.totalChunks || 1)) * 100))
                : status === "completed"
                  ? 100
                  : 0;
              return (
                <article key={chapter.id} className="studio-nested-card-bg grid gap-4 rounded-xl border border-studio-border p-4 lg:grid-cols-[minmax(260px,0.42fr)_minmax(0,0.58fr)]">
                  <div className="grid gap-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(chapter.id)}
                        onChange={() => toggleChapter(chapter.id)}
                        className="mt-1 h-4 w-4 accent-studio-accent"
                        aria-label={`Select ${chapter.title}`}
                      />
                      <div className="min-w-0">
                        <h3 className="font-semibold text-studio-text">
                          {index + 1}. {chapter.title}
                        </h3>
                        <p className="mt-1 text-xs text-studio-muted">
                          {chapter.characterCount.toLocaleString()} chars · {chapter.wordCount.toLocaleString()} words
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-md border px-2 py-1 text-xs ${
                          status === "completed"
                            ? "border-studio-success text-studio-success"
                            : status === "failed"
                              ? "border-red-300 text-red-600"
                              : status === "generating" || status === "queued"
                                ? "border-studio-amber text-studio-amber"
                                : "border-studio-border text-studio-muted"
                        }`}
                      >
                        {generationLabels[status]}
                        {status === "generating" && chapter.totalChunks ? ` ${chapter.completedChunks || 0}/${chapter.totalChunks}` : ""}
                      </span>
                      <button
                        type="button"
                        onClick={() => editChapter(chapter)}
                        className="inline-flex items-center gap-1 rounded-md border border-studio-border px-2 py-1 text-xs font-semibold text-studio-text"
                      >
                        <FilePenLine size={13} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteChapter(chapter)}
                        className="inline-flex items-center gap-1 rounded-md border border-red-300/50 px-2 py-1 text-xs font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-50"
                      >
                        <Trash2 size={13} /> Delete
                      </button>
                    </div>

                    {(status === "queued" || status === "generating" || status === "failed") && (
                      <p className={status === "failed" ? "text-xs text-red-600" : "text-xs text-studio-muted"}>
                        {chapter.error || chapter.progressMessage || "Waiting for progress."}
                      </p>
                    )}

                    {(showProgress || status === "completed") && (
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between text-xs font-semibold text-studio-muted">
                          <span>
                            Segment {chapter.completedChunks || 0}/{chapter.totalChunks || 0}
                          </span>
                          <span>{progressPercent}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-md bg-studio-border">
                          <div className="h-full rounded-md bg-studio-accent transition-all" style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid content-start gap-3">
                    <p className="line-clamp-4 text-sm leading-6 text-studio-muted">{chapter.content}</p>
                    {chapter.audioFile && <HistoryAudioPlayer filename={chapter.audioFile} />}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {lexiconOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 backdrop-blur-sm">
          <section role="dialog" aria-modal="true" className="studio-card-bg max-h-[85vh] w-full max-w-2xl overflow-auto rounded-xl border border-studio-border p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-studio-text">Pronunciation Wordlist</h2>
                <p className="text-sm text-studio-muted">Manual source-to-readable replacements for script preparation.</p>
              </div>
              <button type="button" onClick={() => setLexiconOpen(false)} aria-label="Close wordlist" className="grid h-9 w-9 place-items-center rounded-xl border border-studio-border text-studio-muted">
                <X size={16} />
              </button>
            </div>

            <div className="grid gap-2">
              {lexiconEntries.length === 0 && <p className="text-sm text-studio-muted">Add replacements such as အံ့သြ to အံအော.</p>}
              {lexiconEntries.map((entry, index) => (
                <div key={`${entry.source}-${index}`} className="studio-control-bg grid gap-2 rounded-lg border border-studio-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <input
                    value={entry.source}
                    onChange={(event) => setLexiconEntries((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, source: event.target.value } : item)))}
                    placeholder="Source word"
                    className="rounded-xl border border-studio-border px-2 py-2 text-sm"
                  />
                  <input
                    value={entry.spoken}
                    onChange={(event) => setLexiconEntries((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, spoken: event.target.value } : item)))}
                    placeholder="Readable text"
                    className="rounded-xl border border-studio-border px-2 py-2 text-sm"
                  />
                  <input
                    value={entry.note || ""}
                    onChange={(event) => setLexiconEntries((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, note: event.target.value } : item)))}
                    placeholder="Note"
                    className="rounded-xl border border-studio-border px-2 py-2 text-sm"
                  />
                  <button type="button" onClick={() => setLexiconEntries((items) => items.filter((_, itemIndex) => itemIndex !== index))} aria-label="Delete wordlist entry" className="grid h-9 w-9 place-items-center rounded-xl border border-red-200 text-red-600">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <button type="button" onClick={() => setLexiconEntries((items) => [...items, { source: "", spoken: "", note: "" }])} className="inline-flex items-center gap-2 rounded-xl border border-studio-border px-3 py-2 text-sm font-semibold text-studio-text">
                <Plus size={15} /> Add Entry
              </button>
              <button type="button" onClick={() => void saveLexiconEntries()} className="inline-flex items-center gap-2 rounded-xl bg-studio-accent px-4 py-2 text-sm font-semibold text-studio-text">
                <Save size={15} /> Save Wordlist
              </button>
            </div>
            {lexiconError && <p className="mt-3 text-sm text-red-600">{lexiconError}</p>}
          </section>
        </div>
      )}

    </StudioPageShell>
  );
}
