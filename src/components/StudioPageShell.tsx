import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";

interface StudioPageShellProps {
  activeTab: "script" | "voiceover" | "history" | "storage" | "settings";
  badge: string;
  title: string;
  description: string;
  aside?: ReactNode;
  children: ReactNode;
}

export function StudioPageShell({ activeTab, badge, title, description, aside, children }: StudioPageShellProps) {
  return (
    <div className="min-h-screen bg-studio-bg text-studio-text lg:flex">
      <AppHeader activeTab={activeTab} />

      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-normal text-studio-text sm:text-[28px]">{title}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-studio-muted">{description}</p>
          </div>
          {aside ?? (
            <span className="w-fit rounded-md border border-studio-border bg-white px-3 py-2 font-mono text-xs font-bold text-studio-amber">
              {badge}
            </span>
          )}
        </header>

        {children}
      </main>
    </div>
  );
}
