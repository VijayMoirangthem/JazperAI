"use client";

import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { DashboardPanel } from "@/components/panels/DashboardPanel";
import { ChatPanel, type LoadedSession } from "@/components/panels/ChatPanel";
import { TasksPanel } from "@/components/panels/TasksPanel";
import { LogsPanel } from "@/components/panels/LogsPanel";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { MemoryPanel } from "@/components/panels/MemoryPanel";
import { HistoryPanel } from "@/components/panels/HistoryPanel";
import { JobsPanel } from "@/components/panels/JobsPanel";
import { GmailPanel } from "@/components/panels/GmailPanel";
import { JobApplyPanel } from "@/components/panels/JobApplyPanel";
import { NotificationsPanel } from "@/components/panels/NotificationsPanel";
import { CommandPalette } from "@/components/CommandPalette";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

type View = "dashboard" | "chat" | "history" | "tasks" | "memory" | "logs" | "browser" | "settings" | "jobs" | "gmail" | "jobapply" | "notifications";

const VALID_VIEWS = new Set<string>(["dashboard","chat","history","tasks","memory","logs","browser","settings","jobs","gmail","jobapply","notifications"]);

function getClientView(): View {
  const hash = window.location.hash.slice(1);
  if (VALID_VIEWS.has(hash)) return hash as View;
  const stored = localStorage.getItem("sj-active-view");
  if (stored && VALID_VIEWS.has(stored)) return stored as View;
  return "dashboard";
}

const TITLES: Record<View, string> = {
  dashboard: "Sir Jazper OS — Dashboard",
  chat:      "Sir Jazper OS — Chat",
  history:   "Sir Jazper OS — History",
  tasks:     "Sir Jazper OS — Tasks",
  memory:    "Sir Jazper OS — Memory",
  logs:      "Sir Jazper OS — Logs",
  browser:   "Sir Jazper OS — Browser",
  settings:  "Sir Jazper OS — Settings",
  jobs:      "Sir Jazper OS — Jobs",
  gmail:     "Sir Jazper OS — Gmail",
  jobapply:      "Sir Jazper OS — Job Apply",
  notifications: "Sir Jazper OS — Notifications",
};

function PlaceholderPanel({ label }: { label: string }) {
  return (
    <div
      className="sj-panel"
      style={{ height: "100%", alignItems: "center", justifyContent: "center", display: "flex" }}
    >
      <p className="sj-subheading" style={{ opacity: 0.4 }}>{label} — Coming Soon</p>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("dashboard");
  const [sessionToLoad, setSessionToLoad] = useState<LoadedSession | null>(null);
  const didInit = useRef(false);

  useEffect(() => {
    if (!didInit.current) {
      didInit.current = true;
      const v = getClientView();
      if (v !== "dashboard") {
        setView(v);
        return; // will re-run this effect with the correct view, then fall through to sync
      }
    }
    window.location.hash = view;
    localStorage.setItem("sj-active-view", view);
    document.title = TITLES[view];
  }, [view]);

  // Handle browser back/forward buttons
  useEffect(() => {
    function onHashChange() {
      const hash = window.location.hash.slice(1);
      if (VALID_VIEWS.has(hash)) setView(hash as View);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(v: View) {
    setView(v);
  }

  useKeyboardShortcuts(navigate);

  function handleLoadSession(session: LoadedSession) {
    setSessionToLoad(session);
    navigate("chat");
  }

  const singlePanel: Record<Exclude<View, "dashboard">, React.ReactNode> = {
    chat:     <ChatPanel sessionToLoad={sessionToLoad} onSessionLoaded={() => setSessionToLoad(null)} />,
    history:  <HistoryPanel onLoadSession={handleLoadSession} />,
    tasks:    <TasksPanel />,
    logs:     <LogsPanel />,
    memory:   <MemoryPanel />,
    browser:  <PlaceholderPanel label="Browser Control" />,
    settings: <SettingsPanel />,
    jobs:     <JobsPanel />,
    gmail:    <GmailPanel />,
    jobapply:      <JobApplyPanel />,
    notifications: <NotificationsPanel />,
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--color-bg)" }}>
      <CommandPalette onNavigate={(v) => navigate(v)} />
      <Sidebar active={view} onNavigate={(id) => navigate(id as View)} />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Topbar title={TITLES[view]} />

        {view === "dashboard" ? (
          <div
            style={{
              flex: 1,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 1,
              background: "var(--color-border)",
              overflow: "hidden",
            }}
          >
            <DashboardPanel />
            <div
              style={{
                display: "grid",
                gridTemplateRows: "1fr 1fr",
                gap: 1,
                background: "var(--color-border)",
                overflow: "hidden",
                minHeight: 0,
              }}
            >
              <ChatPanel />
              <TasksPanel />
            </div>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: "hidden" }}>
            {singlePanel[view as Exclude<View, "dashboard">]}
          </div>
        )}
      </div>
    </div>
  );
}
