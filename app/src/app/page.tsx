"use client";

import { useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { ChatPanel2 } from "@/components/panels/ChatPanel2";
import { OfficePanel } from "@/components/panels/OfficePanel";
import { AiProvidersPanel } from "@/components/panels/AiProvidersPanel";
import { BusinessPanel } from "@/components/panels/BusinessPanel";
import { DiffEditorPanel } from "@/components/panels/DiffEditorPanel";
import { CompanyPanel } from "@/components/panels/CompanyPanel";
import { FinOpsPanel } from "@/components/panels/FinOpsPanel";
import { McpHubPanel } from "@/components/panels/McpHubPanel";
import { SystemPanel } from "@/components/panels/SystemPanel";
import { DevLoopPanel } from "@/components/panels/DevLoopPanel";
import { SetupPanel } from "@/components/panels/SetupPanel";
import { LiveAgentsPanel } from "@/components/panels/LiveAgentsPanel";
import { DashboardPanel } from "@/components/panels/DashboardPanel";
import { ChatPanel, type LoadedSession } from "@/components/panels/ChatPanel";
import { TasksPanel } from "@/components/panels/TasksPanel";
import { LogsPanel } from "@/components/panels/LogsPanel";
import { SettingsPanel } from "@/components/panels/SettingsPanel";
import { MemoryV2Panel } from "@/components/panels/MemoryV2Panel";
import { HistoryPanel } from "@/components/panels/HistoryPanel";
import { JobsPanel } from "@/components/panels/JobsPanel";
import { GmailPanel } from "@/components/panels/GmailPanel";
import CalendarPanel from "@/components/panels/CalendarPanel";
import { JobApplyPanel } from "@/components/panels/JobApplyPanel";
import { NotificationsPanel } from "@/components/panels/NotificationsPanel";
import { ObservatoryPanel } from "@/components/panels/ObservatoryPanel";
import { AgentsPanel } from "@/components/panels/AgentsPanel";
import { AgentMarketplacePanel } from "@/components/panels/AgentMarketplacePanel";
import { PhasesPanel } from "@/components/panels/PhasesPanel";
import { RoadmapPanel } from "@/components/panels/RoadmapPanel";
import { PlansPanel } from "@/components/panels/PlansPanel";
import { ITDepartmentPanel } from "@/components/panels/ITDepartmentPanel";
import { VoiceProfilePanel } from "@/components/panels/VoiceProfilePanel";
import { CommandCenterPanel } from "@/components/panels/CommandCenterPanel";
import MunderPanel from "@/components/panels/MunderPanel";
import MunderDifflinPanel from "@/components/panels/MunderDifflinPanel";
import { ApprovalOverlay } from "@/components/ApprovalOverlay";
import { ApprovalsPanel } from "@/components/panels/ApprovalsPanel";
import { IDEPanel } from "@/components/panels/IDEPanel";
import { ControlTowerPanel } from "@/components/panels/ControlTowerPanel";
import { CompanyDashboardPanel } from "@/components/panels/CompanyDashboardPanel";
import { PipelinePanel } from "@/components/panels/PipelinePanel";
import { EvolutionPanel } from "@/components/panels/EvolutionPanel";
import { DBChangeLogPanel } from "@/components/panels/DBChangeLogPanel";
import SharedMemoryPanel from "@/components/panels/SharedMemoryPanel";
import WebhooksPanel from "@/components/panels/WebhooksPanel";
import ModelCostsPanel from "@/components/panels/ModelCostsPanel";
import { BriefingsPanel } from "@/components/panels/BriefingsPanel";
import { ResumePanel } from "@/components/panels/ResumePanel";
import { AutomationPanel } from "@/components/panels/AutomationPanel";
import { KnowledgePanel } from "@/components/panels/KnowledgePanel";
import { ContactsPanel } from "@/components/panels/ContactsPanel";
import { DailyPlannerPanel } from "@/components/panels/DailyPlannerPanel";
import { ApplicationsPanel } from "@/components/panels/ApplicationsPanel";
import { VoiceModePanel } from "@/components/panels/VoiceModePanel";
import { NotificationCenterPanel } from "@/components/panels/NotificationCenterPanel";
import { EmailComposerPanel } from "@/components/panels/EmailComposerPanel";
import { SearchPanel } from "@/components/panels/SearchPanel";
import { HabitsPanel } from "@/components/panels/HabitsPanel";
import { ActivityTimelinePanel } from "@/components/panels/ActivityTimelinePanel";
import { MemoryGraphPanel } from "@/components/panels/MemoryGraphPanel";
import { JobRadarPanel } from "@/components/panels/JobRadarPanel";
import { VoiceJournalPanel } from "@/components/panels/VoiceJournalPanel";
import { RecruiterTemplatesPanel } from "@/components/panels/RecruiterTemplatesPanel";
import { EmailAnalyticsPanel } from "@/components/panels/EmailAnalyticsPanel";
import { RemindersPanel } from "@/components/panels/RemindersPanel";
import { QAPanel } from "@/components/panels/QAPanel";
import { AppFunnelPanel } from "@/components/panels/AppFunnelPanel";
import { NetworkingPanel } from "@/components/panels/NetworkingPanel";
import { SagePanel } from "@/components/panels/SagePanel";
import { InterviewPrepPanel } from "@/components/panels/InterviewPrepPanel";
import { FocusPanel } from "@/components/panels/FocusPanel";
import { GoalsPanel } from "@/components/panels/GoalsPanel";
import { WeeklyDigestPanel } from "@/components/panels/WeeklyDigestPanel";
import { EmailTriagePanel } from "@/components/panels/EmailTriagePanel";
import { MoodPanel } from "@/components/panels/MoodPanel";
import { TaskPriorityPanel } from "@/components/panels/TaskPriorityPanel";
import { FollowUpPanel } from "@/components/panels/FollowUpPanel";
import { ReadingListPanel } from "@/components/panels/ReadingListPanel";
import { SprintsPanel } from "@/components/panels/SprintsPanel";
import { OfferEvalPanel } from "@/components/panels/OfferEvalPanel";
import { PortfolioPanel } from "@/components/panels/PortfolioPanel";
import { SalaryCoachPanel } from "@/components/panels/SalaryCoachPanel";
import { StandupPanel } from "@/components/panels/StandupPanel";
import { QuickActionsBar } from "@/components/QuickActionsBar";
import { StudioLayout } from "@/components/panels/StudioLayout";
import { CommandPalette } from "@/components/CommandPalette";
import { VoiceOrb } from "@/components/voice/VoiceOrb";
import { useApprovals } from "@/hooks/useApprovals";
import { useSettings } from "@/hooks/useSettings";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useGlobalVoice } from "@/hooks/useGlobalVoice";
import { VALID_VIEW_IDS, VIEW_TITLES } from "./plugin-registry";
import PLUGIN_COMPONENTS from "@/plugins/_loader";

// View type is derived from the registry — add panels there, not here
type View = string;

// Merge static registry IDs with dynamic plugin IDs from _loader
const VALID_VIEWS = new Set([
  ...VALID_VIEW_IDS,
  ...Object.keys(PLUGIN_COMPONENTS),
]);

function getClientView(): View {
  const hash = window.location.hash.slice(1);
  const resolved = hash === "munderdifflin" ? "cooshq" : hash;
  if (VALID_VIEWS.has(resolved)) return resolved;
  const stored = localStorage.getItem("sj-active-view");
  if (stored && VALID_VIEWS.has(stored)) return stored;
  return "dashboard";
}

const TITLES = VIEW_TITLES;

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
  const [studioMode, setStudioMode] = useState(false);
  const didInit = useRef(false);
  const { pending, approve, deny } = useApprovals();
  const { settings, save } = useSettings();

  const globalVoice = useGlobalVoice({
    onNavigate: (panel) => {
      // Map voice panel names → View keys
      const PANEL_MAP: Record<string, View> = {
        dashboard:     "dashboard",
        chat:          "chat",
        tasks:         "tasks",
        jobs:          "jobs",
        settings:      "settings",
        "control-tower": "control_tower",
        it_dept:       "it_dept",
        notifications: "notifications",
        observatory:   "observatory",
        ide:           "ide",
      };
      const target = PANEL_MAP[panel];
      if (target) navigate(target);
    },
    onChatMessage: (_text, _response) => {
      // Navigate to chat when a voice question gets a response
      navigate("chat");
    },
  });

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
      const raw = window.location.hash.slice(1);
      const hash = raw === "munderdifflin" ? "cooshq" : raw;
      if (VALID_VIEWS.has(hash)) setView(hash as View);
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  function navigate(v: View) {
    setView(v);
  }

  useKeyboardShortcuts(navigate);

  // Ctrl+Shift+S → toggle Studio Mode
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") {
        e.preventDefault();
        setStudioMode(m => !m);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleLoadSession(session: LoadedSession) {
    setSessionToLoad(session);
    navigate("chat");
  }

  // Panel map — one entry per view. Add new panels here + one entry in plugin-registry.ts
  const singlePanel: Record<string, React.ReactNode> = {
    chat:     <ChatPanel sessionToLoad={sessionToLoad} onSessionLoaded={() => setSessionToLoad(null)} globalVoiceActive={globalVoice.voiceFirstMode} />,
    history:  <HistoryPanel onLoadSession={handleLoadSession} />,
    tasks:    <TasksPanel />,
    logs:     <LogsPanel />,
    memory:   <MemoryV2Panel />,
    browser:  <PlaceholderPanel label="Browser Control" />,
    settings: <SettingsPanel />,
    jobs:     <JobsPanel />,
    gmail:    <GmailPanel />,
    calendar: <CalendarPanel />,
    jobapply:      <JobApplyPanel />,
    notifications: <NotificationCenterPanel />,
    observatory:   <ObservatoryPanel />,
    agents:        <AgentsPanel />,
    marketplace:   <AgentMarketplacePanel onNavigate={(v) => navigate(v)} />,
    phases:        <PhasesPanel onNavigate={(v) => navigate(v)} />,
    roadmap:       <RoadmapPanel />,
    plans:         <PlansPanel />,
    it_dept:        <ITDepartmentPanel onNavigate={(v) => navigate(v)} />,
    voice_profile:  <VoiceProfilePanel />,
    command_center: <CommandCenterPanel />,
    munder:          <MunderPanel />,
    cooshq:          <MunderDifflinPanel />,
    approvals:      <ApprovalsPanel onNavigate={(v) => navigate(v)} />,
    ide:            <IDEPanel />,
    control_tower:  <ControlTowerPanel />,
    live_agents:    <LiveAgentsPanel />,
    dev_loop:       <DevLoopPanel />,
    setup:          <SetupPanel onNavigate={(v) => navigate(v)} />,
    system: <SystemPanel />,
    mcp_hub: <McpHubPanel />,
    finops: <FinOpsPanel />,
    org_chart: <CompanyPanel />,
    diff_editor:    <DiffEditorPanel />,
    business:       <BusinessPanel />,
    ai_providers:   <AiProvidersPanel />,
    office:         <OfficePanel />,
    team_chat:      <ChatPanel2 />,
    company:        <CompanyDashboardPanel />,
    pipeline:       <PipelinePanel />,
    evolution:      <EvolutionPanel />,
    db_changes:     <DBChangeLogPanel />,
    shared_memory:  <SharedMemoryPanel />,
    webhooks:       <WebhooksPanel />,
    model_costs:    <ModelCostsPanel />,
    briefings:      <BriefingsPanel />,
    resume:         <ResumePanel />,
    automation:     <AutomationPanel />,
    knowledge:      <KnowledgePanel />,
    contacts:       <ContactsPanel />,
    planner:        <DailyPlannerPanel />,
    applications:   <ApplicationsPanel />,
    voice_mode:     <VoiceModePanel />,
    compose:             <EmailComposerPanel />,
    search:              <SearchPanel />,
    habits:              <HabitsPanel />,
    activity_timeline:   <ActivityTimelinePanel />,
    memory_graph:        <MemoryGraphPanel />,
    job_radar:           <JobRadarPanel />,
    voice_journal:       <VoiceJournalPanel />,
    templates:           <RecruiterTemplatesPanel />,
    email_analytics:     <EmailAnalyticsPanel />,
    reminders:           <RemindersPanel />,
    qa:                  <QAPanel />,
    app_funnel:          <AppFunnelPanel />,
    networking:          <NetworkingPanel />,
    sage:                <SagePanel />,
    interview_prep:      <InterviewPrepPanel />,
    focus:               <FocusPanel />,
    goals:               <GoalsPanel />,
    digest:              <WeeklyDigestPanel />,
    email_triage:        <EmailTriagePanel />,
    mood:                <MoodPanel />,
    task_priority:       <TaskPriorityPanel />,
    followup:            <FollowUpPanel />,
    reading_list:        <ReadingListPanel />,
    sprints:             <SprintsPanel />,
    offer_eval:          <OfferEvalPanel />,
    portfolio:           <PortfolioPanel />,
    salary_coach:        <SalaryCoachPanel />,
    standup:             <StandupPanel />,
    // Dynamic hot-loaded plugins from frontend/src/plugins/
    ...Object.fromEntries(
      Object.entries(PLUGIN_COMPONENTS).map(([id, Comp]) => [id, <Comp key={id} />])
    ),
  };

  function handleAddAutoApprove(action_type: string) {
    const current = settings.approvals?.autoApproveTypes ?? [];
    if (!current.includes(action_type)) {
      save({ ...settings, approvals: { ...settings.approvals, autoApproveTypes: [...current, action_type] } });
    }
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--color-bg)" }}>
      <QuickActionsBar />
      <CommandPalette onNavigate={(v) => navigate(v)} />
      {!studioMode && <Sidebar active={view} onNavigate={(id) => navigate(id as View)} />}
      <ApprovalOverlay
        pending={pending}
        onApprove={approve}
        onDeny={deny}
        autoApproveTypes={settings.approvals?.autoApproveTypes ?? []}
        onAddAutoApprove={handleAddAutoApprove}
      />

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <Topbar
          title={studioMode ? "Sir Jazper OS — COOS Studio" : TITLES[view]}
          onCommandCenter={() => navigate("command_center")}
          studioMode={studioMode}
          onStudioToggle={() => setStudioMode(m => !m)}
          rightSlot={
            <VoiceOrb
              status={globalVoice.status}
              transcript={globalVoice.transcript}
              lastResponse={globalVoice.lastResponse}
              inConversation={globalVoice.inConversation}
              onToggle={globalVoice.toggleVoiceFirstMode}
              onInterrupt={globalVoice.interrupt}
            />
          }
        />

        {studioMode ? (
          <div style={{ flex: 1, overflow: "hidden" }}>
            <StudioLayout />
          </div>
        ) : view === "dashboard" ? (
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
            {singlePanel[view] ?? <PlaceholderPanel label={view} />}
          </div>
        )}
      </div>
    </div>
  );
}

