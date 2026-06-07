"use client";

import { AudioLines, Circle, FolderOpen, History, Mic2, Settings, Sparkles } from "lucide-react";
import Link from "next/link";

interface AppHeaderProps {
  activeTab: "script" | "voiceover" | "history" | "storage" | "settings";
}

export function AppHeader({ activeTab }: AppHeaderProps) {
  const tabClass = (tab: AppHeaderProps["activeTab"]) =>
    `inline-flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
      activeTab === tab
        ? "bg-studio-border text-studio-text"
        : "text-studio-muted hover:bg-studio-border/55 hover:text-studio-text"
    }`;

  return (
    <aside className="border-studio-border bg-studio-sidebar flex shrink-0 flex-col gap-6 border-b px-4 py-4 lg:min-h-screen lg:w-[260px] lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
      <Link href="/" className="flex items-center gap-2 px-1" prefetch aria-label="Thalika voice over">
        <AudioLines size={24} className="text-studio-accent" />
        <span className="text-xl font-bold text-studio-text">Thalika</span>
        <span className="rounded bg-studio-bg px-1.5 py-0.5 font-mono text-[10px] font-semibold text-studio-accent">local</span>
      </Link>

      <nav className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1" aria-label="Primary navigation">
        <Link href="/script" className={tabClass("script")} prefetch>
          <Sparkles size={18} className={activeTab === "script" ? "text-studio-accent" : undefined} />
          Script Rewriter
        </Link>
        <Link href="/" className={tabClass("voiceover")} prefetch>
          <Mic2 size={18} className={activeTab === "voiceover" ? "text-studio-accent" : undefined} />
          Voice Over
        </Link>
        <Link href="/history" className={tabClass("history")} prefetch>
          <History size={18} className={activeTab === "history" ? "text-studio-accent" : undefined} />
          History
        </Link>
        <Link href="/storage" className={tabClass("storage")} prefetch>
          <FolderOpen size={18} className={activeTab === "storage" ? "text-studio-accent" : undefined} />
          Storage Folders
        </Link>
        <Link href="/settings" className={`${tabClass("settings")} lg:hidden`} prefetch>
          <Settings size={18} className={activeTab === "settings" ? "text-studio-accent" : undefined} />
          Settings
        </Link>
      </nav>

      <div className="mt-auto hidden grid gap-3 lg:grid">
        <div className="rounded-lg border border-studio-border bg-studio-bg p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-studio-text">
            <Circle size={8} fill="currentColor" className="text-studio-success" />
            HF Connected
          </div>
          <p className="mt-1 text-xs text-studio-muted">VoxCPM2 Active (Remote)</p>
        </div>
        <Link
          href="/settings"
          className={`inline-flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
            activeTab === "settings" ? "bg-studio-border text-studio-text" : "text-studio-muted hover:bg-studio-border/55 hover:text-studio-text"
          }`}
          prefetch
        >
          <Settings size={18} />
          Settings
        </Link>
      </div>
    </aside>
  );
}
