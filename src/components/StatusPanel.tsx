"use client";

import { CheckCircle2, Loader2, Radio, RotateCcw, Square, XCircle } from "lucide-react";

export type StudioStatus = "idle" | "saving" | "generating" | "completed" | "failed" | "canceled";

interface StatusPanelProps {
  status: StudioStatus;
  error?: string;
  progressMessage?: string;
  completedChunks?: number;
  totalChunks?: number;
  variant?: "card" | "dock";
  actionLoading?: boolean;
  onCancel?: () => void;
  onRetry?: () => void;
}

const labels: Record<StudioStatus, string> = {
  idle: "Idle",
  saving: "Saving script",
  generating: "Generating audio",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
};

export function StatusPanel({
  status,
  error,
  progressMessage,
  completedChunks = 0,
  totalChunks = 0,
  variant = "card",
  actionLoading = false,
  onCancel,
  onRetry
}: StatusPanelProps) {
  const Icon = status === "completed" ? CheckCircle2 : status === "failed" || status === "canceled" ? XCircle : status === "idle" ? Radio : Loader2;
  const showProgress = status === "generating" && totalChunks > 0;
  const progressPercent = showProgress ? Math.min(100, Math.round((completedChunks / totalChunks) * 100)) : 0;
  const panelClass =
    variant === "dock"
      ? "rounded-lg border border-studio-border bg-white/90 p-4 shadow-xl shadow-slate-300/35 backdrop-blur"
      : "studio-card-bg rounded-xl border border-studio-border p-5";

  return (
    <section className={panelClass}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-studio-accent/10 text-studio-accent">
            <Icon size={19} className={status === "saving" || status === "generating" ? "animate-spin" : ""} />
          </div>
          <h2 className="text-lg font-semibold text-studio-text">Status</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === "generating" && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-md border border-red-300/60 px-3 py-1 text-xs font-semibold text-red-600 transition hover:border-red-400 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Square size={13} />}
              Cancel
            </button>
          )}
          {(status === "failed" || status === "canceled") && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-md border border-studio-border px-3 py-1 text-xs font-semibold text-studio-text transition hover:border-studio-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              Retry
            </button>
          )}
          <span
            className={`rounded-md px-3 py-1 text-xs font-semibold ${
              status === "completed"
                ? "bg-studio-successBg text-studio-success"
                : status === "failed" || status === "canceled"
                  ? "bg-red-50 text-red-700"
                  : "bg-studio-border text-studio-muted"
            }`}
          >
            {labels[status]}
          </span>
        </div>
      </div>
      <p className="mt-3 text-sm text-studio-muted">
        {status === "idle" && "Waiting for a valid script."}
        {status === "saving" && (progressMessage || "Starting background generation job.")}
        {status === "generating" && (progressMessage || "Generating audio through the selected provider.")}
        {status === "completed" && "Audio is ready for preview and download."}
        {status === "failed" && (error || "Something went wrong.")}
        {status === "canceled" && "Generation was canceled. Retry will reuse any completed audio segments."}
      </p>
      {showProgress && (
        <div className="mt-4 grid gap-2">
          <div className="flex items-center justify-between text-xs font-semibold text-studio-muted">
            <span>
              Segment {completedChunks}/{totalChunks}
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-md bg-studio-border">
            <div className="h-full rounded-md bg-studio-accent transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}
