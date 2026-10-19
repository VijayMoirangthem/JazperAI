"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard, MessageSquare, ListTodo, Bell, History, Brain,
  ScrollText, Globe, Settings, BriefcaseBusiness, Mail, Briefcase,
  Search, ArrowRight, Terminal, ListPlus, AlarmClock, Users,
  Radio, ShieldCheck, BarChart2, Mic2, FileText, Activity,
} from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface SlashCommand {
  cmd: string;
  syntax: string;
  description: string;
  icon: React.ReactNode;
  run: (
    arg: string,
    toast: (m: string, t?: "success" | "error" | "info" | "warning") => void,
    nav: (v: string) => void
  ) => void | Promise<void>;
}

interface Props {
  onNavigate: (view: string) => void;
}

const NAV_COMMANDS = (nav: (v: string) => void): CommandItem[] => [
  { id: "go-dashboard",     label: "Dashboard",         description: "Overview & metrics",        icon: <LayoutDashboard size={14} />, action: () => nav("dashboard") },
  { id: "go-chat",          label: "Chat",              description: "Talk to Sir Jazper",        icon: <MessageSquare size={14} />,   action: () => nav("chat") },
  { id: "go-tasks",         label: "Tasks",             description: "Manage your tasks",         icon: <ListTodo size={14} />,        action: () => nav("tasks") },
  { id: "go-notifications", label: "Notifications",     description: "View alerts",               icon: <Bell size={14} />,            action: () => nav("notifications") },
  { id: "go-history",       label: "History",           description: "Chat sessions",             icon: <History size={14} />,         action: () => nav("history") },
  { id: "go-memory",        label: "Memory",            description: "Core & extracted",          icon: <Brain size={14} />,           action: () => nav("memory") },
  { id: "go-logs",          label: "Logs",              description: "System logs",               icon: <ScrollText size={14} />,      action: () => nav("logs") },
  { id: "go-jobs",          label: "Jobs",              description: "Job monitor",               icon: <BriefcaseBusiness size={14} />, action: () => nav("jobs") },
  { id: "go-gmail",         label: "Gmail",             description: "Email",                     icon: <Mail size={14} />,            action: () => nav("gmail") },
  { id: "go-jobapply",      label: "Job Apply",         description: "Auto-apply engine",         icon: <Briefcase size={14} />,       action: () => nav("jobapply") },
  { id: "go-settings",      label: "Settings",          description: "Preferences",               icon: <Settings size={14} />,        action: () => nav("settings") },
  { id: "go-radar",         label: "Job Radar",         description: "Matching job feed",         icon: <Radio size={14} />,           action: () => nav("job_radar") },
  { id: "go-contacts",      label: "Contacts",          description: "CRM & networking",          icon: <Users size={14} />,           action: () => nav("contacts") },
  { id: "go-applications",  label: "Applications",      description: "Kanban board",              icon: <BriefcaseBusiness size={14} />, action: () => nav("applications") },
  { id: "go-analytics",     label: "Email Analytics",   description: "Email volume & trends",     icon: <BarChart2 size={14} />,       action: () => nav("email_analytics") },
  { id: "go-voice-journal", label: "Voice Journal",     description: "Record voice notes",        icon: <Mic2 size={14} />,            action: () => nav("voice_journal") },
  { id: "go-templates",     label: "Templates",         description: "Response templates",        icon: <FileText size={14} />,        action: () => nav("templates") },
  { id: "go-reminders",     label: "Reminders",         description: "Smart reminders",           icon: <AlarmClock size={14} />,      action: () => nav("reminders") },
  { id: "go-qa",            label: "QA Center",         description: "Aria sweep & Scribe",       icon: <ShieldCheck size={14} />,     action: () => nav("qa") },
  { id: "go-activity",      label: "Activity Timeline", description: "System activity log",       icon: <Activity size={14} />,        action: () => nav("activity_timeline") },
  { id: "go-funnel",        label: "App Intelligence",  description: "Funnel & salary insights",  icon: <BarChart2 size={14} />,       action: () => nav("app_funnel") },
  { id: "go-networking",    label: "Networking",        description: "Outreach pipeline",         icon: <Users size={14} />,           action: () => nav("networking") },
  { id: "go-sage",          label: "Sage Memory",       description: "Consolidated memory viewer",icon: <Brain size={14} />,           action: () => nav("sage") },
  { id: "go-browser",       label: "Browser",           description: "Browser control",           icon: <Globe size={14} />,           action: () => nav("browser") },
];

const SLASH_COMMANDS = (
  toast: (m: string, t?: "success" | "error" | "info" | "warning") => void,
  nav: (v: string) => void
): SlashCommand[] => [
  {
    cmd: "/task",
    syntax: "/task <title>",
    description: "Create a task instantly",
    icon: <ListPlus size={13} />,
    run: async (arg, t) => {
      const title = arg.trim();
      if (!title) { t("Usage: /task <title>", "warning"); return; }
      try {
        await fetch(`${API}/api/tasks/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, status: "pending", priority: "medium" }),
        });
        t(`Task created: ${title}`, "success");
      } catch { t("Failed to create task", "error"); }
    },
  },
  {
    cmd: "/remind",
    syntax: "/remind <text>",
    description: "Set a reminder (defaults to +1 hour)",
    icon: <AlarmClock size={13} />,
    run: async (arg, t) => {
      const title = arg.trim() || "Reminder";
      const remind_at = new Date(Date.now() + 3600_000).toISOString();
      try {
        await fetch(`${API}/api/reminders`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, remind_at }),
        });
        t(`Reminder set: ${title}`, "success");
      } catch { t("Failed to set reminder", "error"); }
    },
  },
  {
    cmd: "/draft",
    syntax: "/draft <subject>",
    description: "Open email composer with subject prefilled",
    icon: <Mail size={13} />,
    run: (arg, t, n) => {
      localStorage.setItem("sj_compose_prefill", JSON.stringify({ subject: arg.trim() }));
      n("compose");
      t("Composer opened", "info");
    },
  },
  {
    cmd: "/search",
    syntax: "/search <query>",
    description: "Search across everything",
    icon: <Search size={13} />,
    run: (arg, t, n) => {
      localStorage.setItem("sj_search_prefill", arg.trim());
      n("search");
    },
  },
  {
    cmd: "/contact",
    syntax: "/contact <name>",
    description: "Jump to contacts, prefill search",
    icon: <Users size={13} />,
    run: (arg, t, n) => {
      localStorage.setItem("sj_contacts_search", arg.trim());
      n("contacts");
    },
  },
  {
    cmd: "/prep",
    syntax: "/prep <company or event>",
    description: "Generate meeting prep brief",
    icon: <Brain size={13} />,
    run: async (arg, t, n) => {
      t(`Generating prep brief for: ${arg}…`, "info");
      try {
        const res = await fetch(`${API}/api/calendar/prep`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: arg.trim(), attendees: [], description: "" }),
        });
        const data = await res.json();
        if (data.brief) {
          localStorage.setItem("sj_prep_brief", JSON.stringify({ title: arg.trim(), brief: data.brief }));
          n("calendar");
          t("Prep brief ready — check Calendar", "success");
        } else { t("No brief returned", "warning"); }
      } catch { t("Prep failed", "error"); }
    },
  },
  {
    cmd: "/scan",
    syntax: "/scan",
    description: "Trigger Job Radar scan now",
    icon: <Radio size={13} />,
    run: async (arg, t) => {
      t("Job Radar scan started…", "info");
      try {
        await fetch(`${API}/api/jobs/radar/scan`, { method: "POST" });
        t("Radar scan complete", "success");
      } catch { t("Radar scan failed", "error"); }
    },
  },
  {
    cmd: "/qa",
    syntax: "/qa",
    description: "Open QA Center (Aria sweep)",
    icon: <ShieldCheck size={13} />,
    run: (arg, t, n) => { n("qa"); t("QA Center opened", "info"); },
  },
  {
    cmd: "/goto",
    syntax: "/goto <panel>",
    description: "Navigate to any panel by ID",
    icon: <Terminal size={13} />,
    run: (arg, t, n) => {
      const target = arg.trim().toLowerCase().replace(/\s+/g, "_");
      if (target) { n(target); }
      else { t("Usage: /goto <panel>", "warning"); }
    },
  },
];

export function CommandPalette({ onNavigate }: Props) {
  const toast = useToast();
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const navCommands = NAV_COMMANDS(onNavigate);
  const slashCmds   = SLASH_COMMANDS(toast, onNavigate);

  const isSlash = query.startsWith("/");

  const filtered = isSlash
    ? (() => {
        const q = query.slice(1).toLowerCase();
        return slashCmds.filter(s =>
          s.cmd.slice(1).startsWith(q.split(" ")[0]) ||
          s.description.toLowerCase().includes(q)
        );
      })()
    : query.trim()
    ? navCommands.filter(c =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        (c.description ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : navCommands;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const runNav = useCallback((item: CommandItem) => {
    item.action();
    close();
  }, [close]);

  const runSlash = useCallback(async (sc: SlashCommand) => {
    const arg = query.split(" ").slice(1).join(" ");
    close();
    await sc.run(arg, toast, onNavigate);
  }, [query, close, toast, onNavigate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(prev => !prev);
        if (!open) setQuery("");
      }
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 30); setSelected(0); }
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") {
      if (isSlash) {
        const sc = filtered[selected] as SlashCommand | undefined;
        if (sc) runSlash(sc);
        else close();
      } else {
        const item = filtered[selected] as CommandItem | undefined;
        if (item) runNav(item);
      }
    } else if (e.key === "Tab" && isSlash && !query.includes(" ")) {
      e.preventDefault();
      const sc = filtered[0] as SlashCommand | undefined;
      if (sc) setQuery(sc.cmd + " ");
    }
  }

  if (!open) return null;

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "15vh",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 540, maxWidth: "90vw",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-4)", borderBottom: "1px solid var(--color-border)" }}>
          {isSlash
            ? <Terminal size={14} style={{ color: "var(--color-accent)", flexShrink: 0 }} />
            : <Search size={14} style={{ color: "var(--color-icon)", flexShrink: 0 }} />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder='Search panels… or type "/" for commands'
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 14, color: "var(--color-text)",
            }}
          />
          <kbd style={{ fontSize: 10, padding: "2px 6px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 4, color: "var(--color-text-muted)" }}>
            ESC
          </kbd>
        </div>

        {/* Section label */}
        <div style={{ padding: "6px 16px 2px", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: isSlash ? "var(--color-accent)" : "var(--color-text-muted)" }}>
          {isSlash ? "Slash Commands" : query.trim() ? "Results" : "Navigate"}
        </div>

        {/* Results */}
        <div style={{ maxHeight: 380, overflowY: "auto", padding: "var(--sp-1) var(--sp-2)" }}>
          {filtered.length === 0 ? (
            <p style={{ fontSize: 12, textAlign: "center", padding: "var(--sp-4)", color: "var(--color-text-muted)" }}>No results</p>
          ) : isSlash ? (
            (filtered as SlashCommand[]).map((sc, i) => (
              <div
                key={sc.cmd}
                onClick={() => runSlash(sc)}
                onMouseEnter={() => setSelected(i)}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--sp-3)",
                  padding: "var(--sp-2) var(--sp-3)", borderRadius: 6, cursor: "pointer",
                  background: i === selected ? "var(--color-surface-raised)" : "transparent",
                }}
              >
                <span style={{ color: "var(--color-accent)", display: "flex", flexShrink: 0 }}>{sc.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--color-text)", fontFamily: "var(--font-mono)" }}>{sc.syntax}</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{sc.description}</div>
                </span>
                {i === selected && (
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0 }}>Tab · ↵ run</span>
                )}
              </div>
            ))
          ) : (
            (filtered as CommandItem[]).map((item, i) => (
              <div
                key={item.id}
                onClick={() => runNav(item)}
                onMouseEnter={() => setSelected(i)}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--sp-3)",
                  padding: "var(--sp-2) var(--sp-3)", borderRadius: 6, cursor: "pointer",
                  background: i === selected ? "var(--color-surface-raised)" : "transparent",
                }}
              >
                <span style={{ color: "var(--color-icon)", display: "flex" }}>{item.icon}</span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--color-text)" }}>{item.label}</div>
                  {item.description && <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{item.description}</div>}
                </span>
                {i === selected && <ArrowRight size={12} style={{ color: "var(--color-icon)" }} />}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "var(--sp-2) var(--sp-4)", borderTop: "1px solid var(--color-border)", display: "flex", gap: "var(--sp-3)", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "var(--sp-3)" }}>
            {[["↑↓", "navigate"], ["↵", "select"], ["Esc", "close"]].map(([key, hint]) => (
              <span key={key} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 10, color: "var(--color-text-muted)" }}>
                <kbd style={{ fontSize: 9, padding: "1px 4px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 3 }}>{key}</kbd>
                {hint}
              </span>
            ))}
          </div>
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {isSlash
              ? <><kbd style={{ fontSize: 9, padding: "1px 4px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 3 }}>Tab</kbd> complete</>
              : <>type <kbd style={{ fontSize: 9, padding: "1px 4px", background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 3, fontFamily: "var(--font-mono)" }}>/</kbd> for commands</>
            }
          </span>
        </div>
      </div>
    </div>
  );
}
