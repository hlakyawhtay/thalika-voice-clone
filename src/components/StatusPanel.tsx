"use client";

import { CheckCircle2, Loader2, Radio, XCircle } from "lucide-react";

export type StudioStatus = "idle" | "saving" | "generating" | "completed" | "failed";

interface StatusPanelProps {
  status: StudioStatus;
  error?: string;
  progressMessage?: string;
  completedChunks?: number;
  totalChunks?: number;
  variant?: "card" | "dock";
}

const labels: Record<StudioStatus, string> = {
  idle: "Idle",
  saving: "Saving script",
  generating: "Generating audio",
  completed: "Completed",
  failed: "Failed"
};

export function StatusPanel({
  status,
  error,
  progressMessage,
  completedChunks = 0,
  totalChunks = 0,
  variant = "card"
}: StatusPanelProps) {
  const Icon = status === "completed" ? CheckCircle2 : status === "failed" ? XCircle : status === "idle" ? Radio : Loader2;
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
        <span
          className={`rounded-md px-3 py-1 text-xs font-semibold ${
            status === "completed"
              ? "bg-studio-successBg text-studio-success"
              : status === "failed"
                ? "bg-red-50 text-red-700"
                : "bg-studio-border text-studio-muted"
          }`}
        >
          {labels[status]}
        </span>
      </div>
      <p className="mt-3 text-sm text-studio-muted">
        {status === "idle" && "Waiting for a valid script."}
        {status === "saving" && (progressMessage || "Starting background generation job.")}
        {status === "generating" && (progressMessage || "Generating audio through the selected provider.")}
        {status === "completed" && "Audio is ready for preview and download."}
        {status === "failed" && (error || "Something went wrong.")}
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
