"use client";

import { useCallback, useEffect, useState } from "react";
import { HistoryPanel } from "@/components/HistoryPanel";
import { StudioPageShell } from "@/components/StudioPageShell";
import type { ListeningReview } from "@/lib/types";

interface HistoryJob {
  id: string;
  title: string;
  provider: string;
  emotion: string;
  format: string;
  createdAt: string;
  audioFile?: string;
  status: string;
  completedChunks?: number;
  totalChunks?: number;
  progressMessage?: string;
  review?: ListeningReview;
}

export default function HistoryPage() {
  const [jobs, setJobs] = useState<HistoryJob[]>([]);
  const [deletingJobId, setDeletingJobId] = useState<string | undefined>();

  const loadHistory = useCallback(async () => {
    const response = await fetch("/api/history", { cache: "no-store" });
    if (!response.ok) return;
    const data = (await response.json()) as { jobs: HistoryJob[] };
    setJobs(data.jobs);
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === "generating")) return;
    const timer = window.setInterval(() => void loadHistory(), 2000);
    return () => window.clearInterval(timer);
  }, [jobs, loadHistory]);

  async function deleteHistoryJob(job: HistoryJob) {
    const shouldDelete = window.confirm(
      `Delete this history item${job.audioFile ? ` and audio file ${job.audioFile}` : ""}? The original saved script will be kept.`
    );
    if (!shouldDelete) return;

    setDeletingJobId(job.id);
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(job.id)}`, {
        method: "DELETE"
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Could not delete history item");
      }
      await loadHistory();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not delete history item");
    } finally {
      setDeletingJobId(undefined);
    }
  }

  return (
    <StudioPageShell
      activeTab="history"
      badge="Local Markdown history"
      title="Generation History"
      description="Review and manage your local voice cloning runs."
      aside={
        <span className="w-fit rounded-md border border-studio-border bg-white px-3 py-2 text-sm font-medium text-studio-text">
          {jobs.length} recent
        </span>
      }
    >
      <HistoryPanel jobs={jobs} deletingJobId={deletingJobId} onDelete={deleteHistoryJob} onReviewSaved={() => void loadHistory()} />
    </StudioPageShell>
  );
}
