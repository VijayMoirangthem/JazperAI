"use client";

import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { ChatPanel2 } from "@/components/panels/ChatPanel2";
const OfficePanel = lazy(() => import("@/components/panels/OfficePanel").then((m) => ({ default: m.OfficePanel })));
const AiProvidersPanel = lazy(() => import("@/components/panels/AiProvidersPanel").then((m) => ({ default: m.AiProvidersPanel })));
const BusinessPanel = lazy(() => import("@/components/panels/BusinessPanel").then((m) => ({ default: m.BusinessPanel })));
const DiffEditorPanel = lazy(() => import("@/components/panels/DiffEditorPanel").then((m) => ({ default: m.DiffEditorPanel })));
const CompanyPanel = lazy(() => import("@/components/panels/CompanyPanel").then((m) => ({ default: m.CompanyPanel })));
const FinOpsPanel = lazy(() => import("@/components/panels/FinOpsPanel").then((m) => ({ default: m.FinOpsPanel })));
const McpHubPanel = lazy(() => import("@/components/panels/McpHubPanel").then((m) => ({ default: m.McpHubPanel })));
const SystemPanel = lazy(() => import("@/components/panels/SystemPanel").then((m) => ({ default: m.SystemPanel })));
const DevLoopPanel = lazy(() => import("@/components/panels/DevLoopPanel").then((m) => ({ default: m.DevLoopPanel })));
const SetupPanel = lazy(() => import("@/components/panels/SetupPanel").then((m) => ({ default: m.SetupPanel })));
const LiveAgentsPanel = lazy(() => import("@/components/panels/LiveAgentsPanel").then((m) => ({ default: m.LiveAgentsPanel })));
const DashboardPanel = lazy(() => import("@/components/panels/DashboardPanel").then((m) => ({ default: m.DashboardPanel })));
import { ChatPanel, type LoadedSession } from "@/components/panels/ChatPanel";
const TasksPanel = lazy(() => import("@/components/panels/TasksPanel").then((m) => ({ default: m.TasksPanel })));
const LogsPanel = lazy(() => import("@/components/panels/LogsPanel").then((m) => ({ default: m.LogsPanel })));
const SettingsPanel = lazy(() => import("@/components/panels/SettingsPanel").then((m) => ({ default: m.SettingsPanel })));
const MemoryV2Panel = lazy(() => import("@/components/panels/MemoryV2Panel").then((m) => ({ default: m.MemoryV2Panel })));
const HistoryPanel = lazy(() => import("@/components/panels/HistoryPanel").then((m) => ({ default: m.HistoryPanel })));
const JobsPanel = lazy(() => import("@/components/panels/JobsPanel").then((m) => ({ default: m.JobsPanel })));
const GmailPanel = lazy(() => import("@/components/panels/GmailPanel").then((m) => ({ default: m.GmailPanel })));
import CalendarPanel from "@/components/panels/CalendarPanel";
const JobApplyPanel = lazy(() => import("@/components/panels/JobApplyPanel").then((m) => ({ default: m.JobApplyPanel })));
const NotificationsPanel = lazy(() => import("@/components/panels/NotificationsPanel").then((m) => ({ default: m.NotificationsPanel })));
const ObservatoryPanel = lazy(() => import("@/components/panels/ObservatoryPanel").then((m) => ({ default: m.ObservatoryPanel })));
const AgentsPanel = lazy(() => import("@/components/panels/AgentsPanel").then((m) => ({ default: m.AgentsPanel })));
const AgentMarketplacePanel = lazy(() => import("@/components/panels/AgentMarketplacePanel").then((m) => ({ default: m.AgentMarketplacePanel })));
const PhasesPanel = lazy(() => import("@/components/panels/PhasesPanel").then((m) => ({ default: m.PhasesPanel })));
const RoadmapPanel = lazy(() => import("@/components/panels/RoadmapPanel").then((m) => ({ default: m.RoadmapPanel })));
const PlansPanel = lazy(() => import("@/components/panels/PlansPanel").then((m) => ({ default: m.PlansPanel })));
const ITDepartmentPanel = lazy(() => import("@/components/panels/ITDepartmentPanel").then((m) => ({ default: m.ITDepartmentPanel })));
const VoiceProfilePanel = lazy(() => import("@/components/panels/VoiceProfilePanel").then((m) => ({ default: m.VoiceProfilePanel })));
const CommandCenterPanel = lazy(() => import("@/components/panels/CommandCenterPanel").then((m) => ({ default: m.CommandCenterPanel })));
import MunderPanel from "@/components/panels/MunderPanel";
import MunderDifflinPanel from "@/components/panels/MunderDifflinPanel";
import { ApprovalOverlay } from "@/components/ApprovalOverlay";
const ApprovalsPanel = lazy(() => import("@/components/panels/ApprovalsPanel").then((m) => ({ default: m.ApprovalsPanel })));
const IDEPanel = lazy(() => import("@/components/panels/IDEPanel").then((m) => ({ default: m.IDEPanel })));
const ControlTowerPanel = lazy(() => import("@/components/panels/ControlTowerPanel").then((m) => ({ default: m.ControlTowerPanel })));
const CompanyDashboardPanel = lazy(() => import("@/components/panels/CompanyDashboardPanel").then((m) => ({ default: m.CompanyDashboardPanel })));
const PipelinePanel = lazy(() => import("@/components/panels/PipelinePanel").then((m) => ({ default: m.PipelinePanel })));
const EvolutionPanel = lazy(() => import("@/components/panels/EvolutionPanel").then((m) => ({ default: m.EvolutionPanel })));
const DBChangeLogPanel = lazy(() => import("@/components/panels/DBChangeLogPanel").then((m) => ({ default: m.DBChangeLogPanel })));
import SharedMemoryPanel from "@/components/panels/SharedMemoryPanel";
import WebhooksPanel from "@/components/panels/WebhooksPanel";
import ModelCostsPanel from "@/components/panels/ModelCostsPanel";
const BriefingsPanel = lazy(() => import("@/components/panels/BriefingsPanel").then((m) => ({ default: m.BriefingsPanel })));
const ResumePanel = lazy(() => import("@/components/panels/ResumePanel").then((m) => ({ default: m.ResumePanel })));
const AutomationPanel = lazy(() => import("@/components/panels/AutomationPanel").then((m) => ({ default: m.AutomationPanel })));
const KnowledgePanel = lazy(() => import("@/components/panels/KnowledgePanel").then((m) => ({ default: m.KnowledgePanel })));
const ContactsPanel = lazy(() => import("@/components/panels/ContactsPanel").then((m) => ({ default: m.ContactsPanel })));
const DailyPlannerPanel = lazy(() => import("@/components/panels/DailyPlannerPanel").then((m) => ({ default: m.DailyPlannerPanel })));
const ApplicationsPanel = lazy(() => import("@/components/panels/ApplicationsPanel").then((m) => ({ default: m.ApplicationsPanel })));
const VoiceModePanel = lazy(() => import("@/components/panels/VoiceModePanel").then((m) => ({ default: m.VoiceModePanel })));
const NotificationCenterPanel = lazy(() => import("@/components/panels/NotificationCenterPanel").then((m) => ({ default: m.NotificationCenterPanel })));
const EmailComposerPanel = lazy(() => import("@/components/panels/EmailComposerPanel").then((m) => ({ default: m.EmailComposerPanel })));
const SearchPanel = lazy(() => import("@/components/panels/SearchPanel").then((m) => ({ default: m.SearchPanel })));
const HabitsPanel = lazy(() => import("@/components/panels/HabitsPanel").then((m) => ({ default: m.HabitsPanel })));
const ActivityTimelinePanel = lazy(() => import("@/components/panels/ActivityTimelinePanel").then((m) => ({ default: m.ActivityTimelinePanel })));
const MemoryGraphPanel = lazy(() => import("@/components/panels/MemoryGraphPanel").then((m) => ({ default: m.MemoryGraphPanel })));
const JobRadarPanel = lazy(() => import("@/components/panels/JobRadarPanel").then((m) => ({ default: m.JobRadarPanel })));
const VoiceJournalPanel = lazy(() => import("@/components/panels/VoiceJournalPanel").then((m) => ({ default: m.VoiceJournalPanel })));
const RecruiterTemplatesPanel = lazy(() => import("@/components/panels/RecruiterTemplatesPanel").then((m) => ({ default: m.RecruiterTemplatesPanel })));
const EmailAnalyticsPanel = lazy(() => import("@/components/panels/EmailAnalyticsPanel").then((m) => ({ default: m.EmailAnalyticsPanel })));
const RemindersPanel = lazy(() => import("@/components/panels/RemindersPanel").then((m) => ({ default: m.RemindersPanel })));
const QAPanel = lazy(() => import("@/components/panels/QAPanel").then((m) => ({ default: m.QAPanel })));
const AppFunnelPanel = lazy(() => import("@/components/panels/AppFunnelPanel").then((m) => ({ default: m.AppFunnelPanel })));
const NetworkingPanel = lazy(() => import("@/components/panels/NetworkingPanel").then((m) => ({ default: m.NetworkingPanel })));
const SagePanel = lazy(() => import("@/components/panels/SagePanel").then((m) => ({ default: m.SagePanel })));
const InterviewPrepPanel = lazy(() => import("@/components/panels/InterviewPrepPanel").then((m) => ({ default: m.InterviewPrepPanel })));
const FocusPanel = lazy(() => import("@/components/panels/FocusPanel").then((m) => ({ default: m.FocusPanel })));
const GoalsPanel = lazy(() => import("@/components/panels/GoalsPanel").then((m) => ({ default: m.GoalsPanel })));
const WeeklyDigestPanel = lazy(() => import("@/components/panels/WeeklyDigestPanel").then((m) => ({ default: m.WeeklyDigestPanel })));
const EmailTriagePanel = lazy(() => import("@/components/panels/EmailTriagePanel").then((m) => ({ default: m.EmailTriagePanel })));
const MoodPanel = lazy(() => import("@/components/panels/MoodPanel").then((m) => ({ default: m.MoodPanel })));
const TaskPriorityPanel = lazy(() => import("@/components/panels/TaskPriorityPanel").then((m) => ({ default: m.TaskPriorityPanel })));
const FollowUpPanel = lazy(() => import("@/components/panels/FollowUpPanel").then((m) => ({ default: m.FollowUpPanel })));
const ReadingListPanel = lazy(() => import("@/components/panels/ReadingListPanel").then((m) => ({ default: m.ReadingListPanel })));
const SprintsPanel = lazy(() => import("@/components/panels/SprintsPanel").then((m) => ({ default: m.SprintsPanel })));
const OfferEvalPanel = lazy(() => import("@/components/panels/OfferEvalPanel").then((m) => ({ default: m.OfferEvalPanel })));
const PortfolioPanel = lazy(() => import("@/components/panels/PortfolioPanel").then((m) => ({ default: m.PortfolioPanel })));
const SalaryCoachPanel = lazy(() => import("@/components/panels/SalaryCoachPanel").then((m) => ({ default: m.SalaryCoachPanel })));
const StandupPanel = lazy(() => import("@/components/panels/StandupPanel").then((m) => ({ default: m.StandupPanel })));
import { QuickActionsBar } from "@/components/QuickActionsBar";
import { ViewActiveContext } from "@/lib/viewActive";
const MindMapPanel = lazy(() => import("@/components/panels/MindMapPanel").then((m) => ({ default: m.MindMapPanel })));
const ConnectionsPanel = lazy(() => import("@/components/panels/ConnectionsPanel").then((m) => ({ default: m.ConnectionsPanel })));
const SkillsPanel = lazy(() => import("@/components/panels/SkillsPanel").then((m) => ({ default: m.SkillsPanel })));
const StudioLayout = lazy(() => import("@/components/panels/StudioLayout").then((m) => ({ default: m.StudioLayout })));
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
  return "team_chat";
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
  const [view, setView] = useState<View>("team_chat");
  const [sessionToLoad, setSessionToLoad] = useState<LoadedSession | null>(null);
  const [studioMode, setStudioMode] = useState(false);
  // keep-alive: panels you have opened stay mounted (hidden) so switching tabs is instant and nothing reloads; the 8 most recent are kept
  const [visited, setVisited] = useState<View[]>([]);
  useEffect(() => { setVisited((v) => (v.includes(view) ? v : [...v.slice(-7), view])); }, [view]);
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
      if (v !== "team_chat") {
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
    mind_map:       <MindMapPanel />,
    connections:    <ConnectionsPanel />,
    skills:         <SkillsPanel />,
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
      {!["team_chat", "mind_map", "connections", "skills"].includes(view) && <QuickActionsBar />}
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

        <Suspense fallback={<div style={{ flex: 1, display: "grid", placeItems: "center", opacity: 0.5 }}>Loading…</div>}>
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
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {[...new Set([...visited, view])].map((v) => (
              <div key={v} data-keepalive={v} style={{ display: v === view ? "block" : "none", height: "100%" }}>
                <ViewActiveContext.Provider value={v === view}>
                  <Suspense fallback={<div style={{ height: "100%", display: "grid", placeItems: "center", opacity: 0.5 }}>Loading…</div>}>
                    {singlePanel[v] ?? <PlaceholderPanel label={v} />}
                  </Suspense>
                </ViewActiveContext.Provider>
              </div>
            ))}
          </div>
        )}
        </Suspense>
      </div>
    </div>
  );
}
