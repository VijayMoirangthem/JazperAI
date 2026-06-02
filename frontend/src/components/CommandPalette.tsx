"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  LayoutDashboard, MessageSquare, ListTodo, Bell, History, Brain,
  ScrollText, Globe, Settings, BriefcaseBusiness, Mail, Briefcase,
  Search, ArrowRight,
} from "lucide-react";

type View = "dashboard" | "chat" | "history" | "tasks" | "memory" | "logs" | "browser" | "settings" | "jobs" | "gmail" | "jobapply" | "notifications";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
}

interface Props {
  onNavigate: (view: View) => void;
}

const NAV_COMMANDS = (nav: (v: View) => void): CommandItem[] => [
  { id: "go-dashboard",     label: "Dashboard",       description: "Overview & metrics",    icon: <LayoutDashboard size={14} />, action: () => nav("dashboard") },
  { id: "go-chat",          label: "Chat",            description: "Talk to Sir Jazper",    icon: <MessageSquare size={14} />,   action: () => nav("chat") },
  { id: "go-tasks",         label: "Tasks",           description: "Manage your tasks",     icon: <ListTodo size={14} />,        action: () => nav("tasks") },
  { id: "go-notifications", label: "Notifications",   description: "View alerts",           icon: <Bell size={14} />,            action: () => nav("notifications") },
  { id: "go-history",       label: "History",         description: "Chat sessions",         icon: <History size={14} />,         action: () => nav("history") },
  { id: "go-memory",        label: "Memory",          description: "Core & extracted",      icon: <Brain size={14} />,           action: () => nav("memory") },
  { id: "go-logs",          label: "Logs",            description: "System logs",           icon: <ScrollText size={14} />,      action: () => nav("logs") },
  { id: "go-browser",       label: "Browser",         description: "Browser control",       icon: <Globe size={14} />,           action: () => nav("browser") },
  { id: "go-jobs",          label: "Jobs",            description: "Job monitor",           icon: <BriefcaseBusiness size={14} />, action: () => nav("jobs") },
  { id: "go-gmail",         label: "Gmail",           description: "Email",                 icon: <Mail size={14} />,            action: () => nav("gmail") },
  { id: "go-jobapply",      label: "Job Apply",       description: "Auto-apply engine",     icon: <Briefcase size={14} />,       action: () => nav("jobapply") },
  { id: "go-settings",      label: "Settings",        description: "Preferences",           icon: <Settings size={14} />,        action: () => nav("settings") },
];

export function CommandPalette({ onNavigate }: Props) {
  const [open, setOpen]     = useState(false);
  const [query, setQuery]   = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = NAV_COMMANDS(onNavigate);

  const filtered = query.trim()
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        (c.description ?? "").toLowerCase().includes(query.toLowerCase())
      )
    : commands;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelected(0);
  }, []);

  const run = useCallback((item: CommandItem) => {
    item.action();
    close();
  }, [close]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        if (!open) setQuery("");
      }
      if (e.key === "Escape") close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
      setSelected(0);
    }
  }, [open]);

  useEffect(() => { setSelected(0); }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      if (filtered[selected]) run(filtered[selected]);
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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520, maxWidth: "90vw",
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: 10, overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
        }}
      >
        {/* Search input */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", padding: "var(--sp-3) var(--sp-4)", borderBottom: "1px solid var(--color-border)" }}>
          <Search size={14} style={{ color: "var(--color-icon)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search commands..."
            style={{
              flex: 1, background: "none", border: "none", outline: "none",
              fontSize: 14, color: "var(--color-text)",
            }}
          />
          <kbd style={{ fontSize: 10, padding: "2px 6px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 4, color: "var(--color-text-muted)" }}>
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: 360, overflowY: "auto", padding: "var(--sp-2)" }}>
          {filtered.length === 0 ? (
            <p className="sj-micro" style={{ textAlign: "center", padding: "var(--sp-4)" }}>No results</p>
          ) : (
            filtered.map((item, i) => (
              <div
                key={item.id}
                onClick={() => run(item)}
                onMouseEnter={() => setSelected(i)}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--sp-3)",
                  padding: "var(--sp-2) var(--sp-3)", borderRadius: 6, cursor: "pointer",
                  background: i === selected ? "var(--color-surface-2)" : "transparent",
                  transition: "background 0.1s",
                }}
              >
                <span style={{ color: "var(--color-icon)", display: "flex", alignItems: "center" }}>{item.icon}</span>
                <span style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "var(--color-text)" }}>{item.label}</div>
                  {item.description && (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{item.description}</div>
                  )}
                </span>
                {i === selected && <ArrowRight size={12} style={{ color: "var(--color-icon)" }} />}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "var(--sp-2) var(--sp-4)", borderTop: "1px solid var(--color-border)", display: "flex", gap: "var(--sp-3)" }}>
          {[["↑↓", "navigate"], ["↵", "select"], ["Esc", "close"]].map(([key, hint]) => (
            <span key={key} className="sj-micro" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <kbd style={{ fontSize: 9, padding: "1px 4px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 3 }}>{key}</kbd>
              {hint}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
