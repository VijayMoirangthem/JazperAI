/**
 * COOS Plugin Registry — Phase 7A + Navigation Overhaul (System Layer)
 *
 * Single source of truth for every panel in Sir Jazper OS.
 * Extended with the 8-System taxonomy for the new Jarvis-style sidebar.
 *
 * To add a new panel:
 *   1. Create the component in src/components/panels/
 *   2. Add ONE entry to PLUGIN_REGISTRY (with system field)
 *   3. Add ONE line in page.tsx's singlePanel map
 *
 * Everything else (sidebar nav, flyout, pin picker, titles) is derived automatically.
 */

import {
  LayoutDashboard, MessageSquare, ListTodo, Brain, History,
  ScrollText, Globe, Settings, BriefcaseBusiness, Mail,
  Briefcase, Bell, Radio, Users, Layers, Map, GitBranch, Cpu, Mic2,
  Shield, Code2, Server, Building2, Network, Activity, Database,
  Headphones, ShoppingBag, CalendarDays, Puzzle, Zap, Star,
  Webhook, DollarSign, Sunrise, FileText, BookOpen, Search, Repeat2, Download, GitGraph,
  BarChart2, AlarmClock, ShieldCheck, BrainCircuit, Timer,
  Target, Newspaper, Inbox, Smile, Sparkles, SendHorizonal, BookMarked,
  TrendingUp, Mic, FolderGit2, MessagesSquare, GitCompare, Wrench, ListChecks,
  User, Briefcase as BriefcaseIcon, MessageCircle, Lightbulb, CheckSquare,
  Palette, Building, Bot, Factory,
  type LucideIcon,
} from "lucide-react";


// ── Icon map for dynamic (hot-loaded) plugins ─────────────────────────────────

/** Icon name → LucideIcon for dynamic (hot-loaded) plugins */
export const DYNAMIC_ICON_MAP: Record<string, LucideIcon> = {
  Puzzle, Brain, Globe, Code2, Mail, Users, Star, Zap, BookOpen, Search, Repeat2, Download, GitGraph, BarChart2, AlarmClock, ShieldCheck, BrainCircuit, Timer,
  Target, Newspaper, Inbox, Smile, Sparkles, SendHorizonal, BookMarked,
  TrendingUp, Mic, FolderGit2,
  LayoutDashboard, MessageSquare, ListTodo, History, ScrollText,
  BriefcaseBusiness, Briefcase, Bell, Radio, Layers, Map, GitBranch,
  Cpu, Mic2, Shield, Server, Building2, Network, Activity, Database,
  Headphones, ShoppingBag, CalendarDays, Settings, Webhook, DollarSign, Sunrise, FileText,
  User, MessageCircle, Lightbulb, CheckSquare, Palette, Building, Bot,
};


// ── Types ─────────────────────────────────────────────────────────────────────

/** Metadata for a dynamically hot-loaded plugin (from _manifest.json) */
export interface DynamicPluginMeta {
  id: string;
  label: string;
  group: ViewGroup;
  icon: string;
  description: string;
}

export type ViewGroup =
  | "pinned"    // always-visible core strip (Jazper, Dashboard, Alerts)
  | "main"      // legacy group — maps to user-facing systems
  | "agent_os"  // legacy group — maps to Agent OS system
  | "bottom";   // settings / roadmap at very bottom

export type BadgeType = "jobs" | "notifications" | "approvals";

/** System ID — the 8 top-level categories */
export type SystemId =
  | "jazper"
  | "personal"
  | "career"
  | "communications"
  | "intelligence"
  | "productivity"
  | "creative"
  | "business"
  | "agent_os";

/** Metadata for each System shown in the sidebar */
export interface SystemMeta {
  id: SystemId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Hex color for the system accent */
  color: string;
  /** Primary coordinator agent codename */
  coordinatorAgent: string;
  /** Primary agent codenames for this system */
  primaryAgents: string[];
  /** Agent codenames that appear as guests in this system */
  guestAgents?: string[];
}

export interface PluginMeta {
  id: string;
  label: string;
  /** Browser tab title. Defaults to `Sir Jazper OS — {label}` */
  title?: string;
  icon: LucideIcon;
  group: ViewGroup;
  /** Which System this tool belongs to */
  system?: SystemId;
  /** Which live-count badge to show */
  badge?: BadgeType;
  /** Hide from sidebar (still navigable by code). Default: true */
  sidebar?: boolean;
  /** Short description shown in flyout / pin picker */
  description?: string;
}


// ── System Registry ───────────────────────────────────────────────────────────

export const SYSTEM_REGISTRY: SystemMeta[] = [
  {
    id: "jazper",
    label: "Jazper",
    description: "Sir Jasper AI: chat, office, agents, tools, memory, dev loop and system",
    icon: Zap,
    color: "#6366f1",
    coordinatorAgent: "jasper",
    primaryAgents: ["jasper"],
  },
  {
    id: "personal",
    label: "Personal",
    description: "Life, health, habits, mood and focus",
    icon: User,
    color: "#8b5cf6",
    coordinatorAgent: "sage",
    primaryAgents: ["sage", "echo", "habit", "aria", "lore"],
    guestAgents: ["voice"],
  },
  {
    id: "career",
    label: "Career",
    description: "Jobs, applications, resume and interviews",
    icon: BriefcaseIcon,
    color: "#f59e0b",
    coordinatorAgent: "scout",
    primaryAgents: ["scout", "atlas", "phantom", "pitch", "prophet", "verdict"],
    guestAgents: ["hermes"],
  },
  {
    id: "communications",
    label: "Comms",
    description: "Gmail, calendar, contacts and follow-ups",
    icon: MessageCircle,
    color: "#3b82f6",
    coordinatorAgent: "hermes",
    primaryAgents: ["hermes", "beacon", "quill", "clerk"],
    guestAgents: ["scout"],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    description: "Memory, knowledge, research and search",
    icon: Lightbulb,
    color: "#06b6d4",
    coordinatorAgent: "sage",
    primaryAgents: ["sage", "lens", "scout", "archivist", "probe"],
    guestAgents: ["oracle"],
  },
  {
    id: "productivity",
    label: "Productivity",
    description: "Tasks, sprints, goals and planning",
    icon: CheckSquare,
    color: "#10b981",
    coordinatorAgent: "chronos",
    primaryAgents: ["chronos", "compass", "mentor", "analyst", "habit"],
    guestAgents: ["sage"],
  },
  {
    id: "creative",
    label: "Creative",
    description: "Portfolio, writing and voice journal",
    icon: Palette,
    color: "#ec4899",
    coordinatorAgent: "muse",
    primaryAgents: ["muse", "pixel", "quill", "aria"],
    guestAgents: ["voice"],
  },
  {
    id: "business",
    label: "Business",
    description: "Clients, projects, finance and automation",
    icon: Building,
    color: "#f97316",
    coordinatorAgent: "coffer",
    primaryAgents: ["coffer", "audit", "taxman", "clerk", "pipeline"],
    guestAgents: ["atlas"],
  },
  {
    id: "agent_os",
    label: "Agent OS",
    description: "Manage Jazper — agents, evolution, IDE, pipeline",
    icon: Bot,
    color: "#6366f1",
    coordinatorAgent: "jazper",
    primaryAgents: ["darwin", "oracle", "forge", "shield", "scroll", "warden", "sentinel"],
    guestAgents: [],
  },
];

export function getSystem(id: SystemId): SystemMeta | undefined {
  return SYSTEM_REGISTRY.find(s => s.id === id);
}


// ── Plugin Registry ───────────────────────────────────────────────────────────

export const PLUGIN_REGISTRY: PluginMeta[] = [

  // ── Always-pinned core strip ───────────────────────────────────────────────
  { id: "dashboard",     label: "Dashboard",    description: "Today overview — stats, tasks, activity",    icon: LayoutDashboard,   group: "pinned", sidebar: false },
  { id: "chat",          label: "Jazper",        description: "Chat with Jazper — your AI command center", icon: MessageSquare,     group: "pinned", sidebar: false },
  { id: "notifications", label: "Notifications", description: "Alerts, job results, agent notifications",  icon: Bell,              group: "pinned", sidebar: false, badge: "notifications" },
  { id: "munder",        label: "Munder Difflin", title: "Sir Jazper OS — Munder Difflin",
    description: "Office floor demo (archived roster in storage/archive/munder)", icon: Building2, group: "pinned", sidebar: false },
  { id: "cooshq", label: "COOS HQ", title: "CREATE ORIGINS OS — COOS HQ",
    description: "Live command floor — all departments & agents, hive + WebSocket",
    icon: Factory, group: "pinned", sidebar: false },

  // ── Personal System ───────────────────────────────────────────────────────
  { id: "mood",            label: "Mood & Energy",   description: "Track mood and energy levels",           icon: Smile,          group: "main",      system: "personal" },
  { id: "habits",          label: "Habits",          description: "Build and track daily habits",           icon: Repeat2,        group: "main",      system: "personal" },
  { id: "focus",           label: "Focus Timer",     description: "Deep work sessions and Pomodoro timer",  icon: Timer,          group: "main",      system: "personal" },
  { id: "voice_journal",   label: "Voice Journal",   description: "Record thoughts and reflections",        icon: Mic,            group: "main",      system: "personal" },
  { id: "reading_list",    label: "Reading List",    description: "Articles and books to read",             icon: BookMarked,     group: "main",      system: "personal" },
  { id: "memory",          label: "Memory",          description: "Your personal memory store",             icon: Brain,          group: "main",      system: "personal" },
  { id: "briefings",       label: "Daily Brief",     description: "AI-generated morning summary",           icon: Sunrise,        group: "agent_os",  system: "personal" },
  { id: "phases",          label: "Mind Simulation", description: "Digital mind and personality profiles",  icon: Layers,         group: "agent_os",  system: "personal" },
  { id: "voice_mode",      label: "Voice Mode",      description: "Hands-free voice interface",             icon: Headphones,     group: "agent_os",  system: "personal" },
  { id: "voice_profile",   label: "Voice Profile",   description: "Voice settings and AI voice profiling",  icon: Mic2,           group: "agent_os",  system: "personal" },

  // ── Career System ─────────────────────────────────────────────────────────
  { id: "jobs",          label: "Job Search",      description: "Browse and manage job listings",           icon: BriefcaseBusiness, group: "main", system: "career", badge: "jobs" },
  { id: "jobapply",      label: "Job Apply",       description: "Automated LinkedIn Easy Apply",           icon: Briefcase,         group: "main", system: "career" },
  { id: "applications",  label: "Applications",    description: "Track all job applications and status",   icon: BriefcaseBusiness, group: "main", system: "career" },
  { id: "job_radar",     label: "Job Radar",       description: "Smart job alerts and market signals",     icon: Radio,             group: "main", system: "career" },
  { id: "resume",        label: "Resume Builder",  description: "AI-powered resume optimization",          icon: FileText,          group: "agent_os", system: "career" },
  { id: "interview_prep",label: "Interview Prep",  description: "Practice questions and coaching",         icon: BrainCircuit,      group: "main",     system: "career" },
  { id: "salary_coach",  label: "Salary Coach",    description: "Negotiation guidance and benchmarks",     icon: TrendingUp,        group: "main",     system: "career" },
  { id: "offer_eval",    label: "Offer Evaluator", description: "Compare and evaluate job offers",         icon: DollarSign,        group: "main",     system: "career" },
  { id: "networking",    label: "Networking",      description: "Manage professional connections",         icon: Users,             group: "main",     system: "career" },
  { id: "app_funnel",    label: "App Intelligence",description: "Application pipeline analytics",          icon: BarChart2,         group: "main",     system: "career" },

  // ── Communications System ─────────────────────────────────────────────────
  { id: "gmail",          label: "Gmail",           description: "Full Gmail inbox management",            icon: Mail,          group: "main",     system: "communications" },
  { id: "email_triage",   label: "Email Triage",    description: "AI-powered inbox triage and sorting",   icon: Inbox,         group: "main",     system: "communications" },
  { id: "compose",        label: "Compose Email",   description: "Draft and send emails with AI help",    icon: Mail,          group: "main",     system: "communications" },
  { id: "email_analytics",label: "Email Analytics", description: "Email patterns and response analytics", icon: BarChart2,     group: "agent_os", system: "communications" },
  { id: "followup",       label: "Follow-Ups",      description: "Track emails that need a reply",        icon: SendHorizonal, group: "main",     system: "communications" },
  { id: "calendar",       label: "Calendar",        description: "Google Calendar read and write",        icon: CalendarDays,  group: "main",     system: "communications" },
  { id: "contacts",       label: "Contacts",        description: "Manage professional contacts",          icon: Users,         group: "main",     system: "communications" },
  { id: "templates",      label: "Templates",       description: "Email and message templates",           icon: FileText,      group: "main",     system: "communications" },
  { id: "reminders",      label: "Reminders",       description: "Smart reminders and alerts",            icon: AlarmClock,    group: "main",     system: "communications" },

  // ── Intelligence System ───────────────────────────────────────────────────
  { id: "memory_graph",  label: "Memory Graph",    description: "Visual memory network explorer",         icon: GitGraph,   group: "agent_os", system: "intelligence" },
  { id: "knowledge",     label: "Knowledge Base",  description: "Personal knowledge library",             icon: BookOpen,   group: "agent_os", system: "intelligence" },
  { id: "shared_memory", label: "Shared Memory",   description: "Cross-agent shared memory space",        icon: Brain,      group: "agent_os", system: "intelligence" },
  { id: "search",        label: "Search",          description: "Search across everything in Jazper",     icon: Search,     group: "main",     system: "intelligence" },
  { id: "sage",          label: "Sage Memory",     description: "Sage agent memory and context explorer", icon: Brain,      group: "agent_os", system: "intelligence" },
  { id: "history",       label: "History",         description: "Past conversations and sessions",        icon: History,    group: "main",     system: "intelligence" },
  { id: "digest",        label: "Weekly Digest",   description: "AI-generated weekly summary",            icon: Newspaper,  group: "agent_os", system: "intelligence" },

  // ── Productivity System ───────────────────────────────────────────────────
  { id: "tasks",         label: "Tasks",           description: "Task list with priorities and due dates", icon: ListTodo,      group: "main",     system: "productivity" },
  { id: "planner",       label: "Daily Planner",   description: "Plan your day with AI guidance",          icon: CalendarDays,  group: "main",     system: "productivity" },
  { id: "sprints",       label: "Sprints",         description: "Sprint planning and tracking",            icon: Layers,        group: "main",     system: "productivity" },
  { id: "goals",         label: "Goals",           description: "Long-term goals and milestones",          icon: Target,        group: "main",     system: "productivity" },
  { id: "standup",       label: "Daily Standup",   description: "AI-facilitated daily standup",            icon: Mic,           group: "main",     system: "productivity" },
  { id: "task_priority", label: "Task Priority",   description: "AI-powered task prioritization",          icon: Sparkles,      group: "main",     system: "productivity" },
  { id: "activity_timeline", label: "Timeline",    description: "Full activity and action timeline",       icon: Activity,      group: "agent_os", system: "productivity" },
  { id: "logs",          label: "Logs",            description: "Live structured log stream",              icon: ScrollText,    group: "agent_os", system: "productivity" },

  // ── Creative System ───────────────────────────────────────────────────────
  { id: "portfolio",     label: "Portfolio",       description: "Showcase projects and work",              icon: FolderGit2, group: "main", system: "creative" },

  // ── Business System ───────────────────────────────────────────────────────
  { id: "workflows",     label: "Workflows",       description: "Custom automation workflows",             icon: GitBranch, group: "agent_os", system: "business" },
  { id: "webhooks",      label: "Webhooks",        description: "Inbound webhooks and event triggers",    icon: Webhook,   group: "agent_os", system: "business" },
  { id: "automation",    label: "Automation",      description: "Browser and task automation",            icon: Zap,       group: "agent_os", system: "business" },
  { id: "browser",       label: "Browser",         description: "Browser automation and control",         icon: Globe,     group: "main",     system: "business" },

  // ── Agent OS (meta layer) ─────────────────────────────────────────────────
  { id: "agents",        label: "Agents",          description: "Agent registry — create, activate, retire", icon: Users,       group: "agent_os", system: "agent_os" },
  { id: "marketplace",   label: "Marketplace",     description: "Agent template gallery",                    icon: ShoppingBag, group: "agent_os", system: "agent_os" },
  { id: "evolution",     label: "Evolution Log",   description: "Agent mutation audit trail",                icon: Activity,    group: "agent_os", system: "agent_os" },
  { id: "it_dept",       label: "IT Department",   description: "Error repair tickets and auto-fix",         icon: Cpu,         group: "agent_os", system: "agent_os" },
  { id: "approvals",     label: "Approvals",       description: "Pending agent approval requests",           icon: Shield,      group: "agent_os", system: "agent_os", badge: "approvals" },
  { id: "pipeline",      label: "Pipeline",        description: "Multi-agent pipeline mind map",             icon: Network,     group: "agent_os", system: "agent_os" },
  { id: "ide",           label: "IDE",             description: "In-browser code editor",                    icon: Code2,       group: "agent_os", system: "agent_os" },
  { id: "db_changes",    label: "DB Changes",      description: "Database change log with rollback",         icon: Database,    group: "agent_os", system: "agent_os" },
  { id: "model_costs",   label: "Model Costs",     description: "AI model usage and cost tracking",          icon: DollarSign,  group: "agent_os", system: "agent_os" },
  { id: "qa",            label: "QA Center",       description: "Quality assurance and testing",             icon: ShieldCheck, group: "agent_os", system: "agent_os" },
  { id: "observatory",   label: "Observatory",     description: "Live agent feed and session monitor",       icon: Radio,       group: "agent_os", system: "agent_os" },
  { id: "company",       label: "Company",         description: "Company-level KPIs and dept scorecards",    icon: Building2,   group: "agent_os", system: "agent_os" },
  { id: "team_chat",     label: "Team Chat",      description: "Chat with Sir Jasper, agents and department channels", icon: MessagesSquare,   group: "agent_os", system: "jazper" },
  { id: "office",        label: "Virtual Office", description: "2D office with live agent bubbles", icon: Building2, group: "agent_os", system: "jazper" },
  { id: "ai_providers",  label: "AI Providers",  description: "Add AI providers, models and tier routing", icon: Cpu, group: "agent_os", system: "jazper" },
  { id: "business",      label: "Business",      description: "Clients, projects, team and finance", icon: BriefcaseBusiness, group: "agent_os", system: "jazper" },
  { id: "diff_editor",   label: "AI Diff Editor", description: "Streamed AI edits with per-hunk accept/reject", icon: GitCompare, group: "agent_os", system: "jazper" },
  { id: "finops", label: "FinOps", description: "Token usage, budgets and forecast", icon: DollarSign, group: "agent_os", system: "jazper" },
  { id: "mcp_hub", label: "Tool Hub", description: "MCP connectors and tools", icon: Wrench, group: "agent_os", system: "jazper" },
  { id: "system", label: "System", description: "Health, secrets and backups", icon: ShieldCheck, group: "agent_os", system: "jazper" },
  { id: "org_chart", label: "Org Chart", description: "Live org chart and executive directives", icon: Network, group: "agent_os", system: "jazper" },
  { id: "dev_loop", label: "Dev Loop", description: "AI code changes on a branch, with tests and approved merge", icon: GitBranch, group: "agent_os", system: "jazper" },
  { id: "setup", label: "Setup", description: "First-run checklist", icon: ListChecks, group: "agent_os", system: "jazper" },
  { id: "live_agents",   label: "Live Agents",    description: "Real-time agent states from the event bus", icon: Activity,       group: "agent_os", system: "jazper" },
  { id: "control_tower", label: "Control Tower",   description: "System control and monitoring",             icon: Server,      group: "agent_os", system: "agent_os" },
  { id: "plans",         label: "Plans",           description: "Multi-step agent plan tracker",             icon: GitBranch,   group: "agent_os", system: "agent_os" },

  // command_center is navigated to programmatically; no sidebar icon
  { id: "command_center", label: "Command Center",
    title: "Sir Jazper OS — Command Center", icon: Map, group: "agent_os", system: "agent_os", sidebar: false },

  // ── Bottom ────────────────────────────────────────────────────────────────
  { id: "roadmap",   label: "Roadmap",  description: "Project roadmap and changelog",  icon: Map,      group: "bottom" },
  { id: "settings",  label: "Settings", description: "App settings and preferences",   icon: Settings, group: "bottom" },
];

/** Set of all valid view IDs — used by page.tsx for URL hash validation */
export const VALID_VIEW_IDS = new Set(PLUGIN_REGISTRY.map(p => p.id));

/** Browser tab title map */
export const VIEW_TITLES: Record<string, string> = Object.fromEntries(
  PLUGIN_REGISTRY.map(p => [p.id, p.title ?? `Sir Jazper OS — ${p.label}`])
);

/** Get all tools for a given system (usable in flyout) */
export function getSystemTools(systemId: SystemId): PluginMeta[] {
  return PLUGIN_REGISTRY.filter(p => p.system === systemId && p.sidebar !== false);
}

/** Legacy sidebar groups — kept so existing components compile without breaking */
export const SIDEBAR_MAIN     = PLUGIN_REGISTRY.filter(p => p.group === "main"     && p.sidebar !== false);
export const SIDEBAR_AGENT_OS = PLUGIN_REGISTRY.filter(p => p.group === "agent_os" && p.sidebar !== false);
export const SIDEBAR_BOTTOM   = PLUGIN_REGISTRY.filter(p => p.group === "bottom"   && p.sidebar !== false);
export const SIDEBAR_PINNED   = PLUGIN_REGISTRY.filter(p => p.group === "pinned");


// ── Pinned tools — localStorage persistence ───────────────────────────────────

const PINNED_KEY = "sj-pinned-tools";

/** Core pinned tools — always visible and cannot be removed */
export const CORE_PINNED = ["chat", "dashboard", "notifications", "munder", "cooshq"] as const;

export const MAX_USER_PINS = 8;

export function loadPinnedTools(): string[] {
  if (typeof window === "undefined") return [...CORE_PINNED];
  try {
    const raw = localStorage.getItem(PINNED_KEY);
    if (!raw) return [...CORE_PINNED];
    const extra: string[] = JSON.parse(raw);
    // Validate and dedupe
    const valid = extra.filter(id => VALID_VIEW_IDS.has(id) && !CORE_PINNED.includes(id as typeof CORE_PINNED[number]));
    return [...CORE_PINNED, ...valid];
  } catch {
    return [...CORE_PINNED];
  }
}

/** Save the user-pinned extra tools (not including CORE_PINNED) */
export function savePinnedTools(allPinned: string[]): void {
  if (typeof window === "undefined") return;
  const extra = allPinned.filter(id => !CORE_PINNED.includes(id as typeof CORE_PINNED[number]));
  localStorage.setItem(PINNED_KEY, JSON.stringify(extra));
}

export function isPinnedByDefault(id: string): boolean {
  return CORE_PINNED.includes(id as typeof CORE_PINNED[number]);
}

