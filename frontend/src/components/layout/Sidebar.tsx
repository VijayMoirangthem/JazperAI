"use client";

import { useState, useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  MessageSquare,
  ListTodo,
  Brain,
  History,
  ScrollText,
  Globe,
  Settings,
  BriefcaseBusiness,
  Mail,
  Briefcase,
  Bell,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type NavItem = {
  id: string;
  icon: React.ReactNode;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "dashboard",     icon: <LayoutDashboard size={16} />,   label: "Dashboard" },
  { id: "chat",          icon: <MessageSquare size={16} />,     label: "Chat" },
  { id: "tasks",         icon: <ListTodo size={16} />,          label: "Tasks" },
  { id: "notifications", icon: <Bell size={16} />,              label: "Notifications" },
  { id: "history",       icon: <History size={16} />,           label: "History" },
  { id: "memory",        icon: <Brain size={16} />,             label: "Memory" },
  { id: "logs",          icon: <ScrollText size={16} />,        label: "Logs" },
  { id: "browser",       icon: <Globe size={16} />,             label: "Browser" },
  { id: "jobs",          icon: <BriefcaseBusiness size={16} />, label: "Jobs" },
  { id: "gmail",         icon: <Mail size={16} />,              label: "Gmail" },
  { id: "jobapply",      icon: <Briefcase size={16} />,         label: "Job Apply" },
];

interface SidebarProps {
  active: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const [jobsBadge, setJobsBadge]   = useState(0);
  const [notifBadge, setNotifBadge] = useState(0);

  const fetchBadges = useCallback(async () => {
    try {
      const [jr, nr] = await Promise.all([
        fetch(`${API}/api/jobs/notifications/unread-count`),
        fetch(`${API}/api/notifications/unread-count`),
      ]);
      const [jd, nd] = await Promise.all([jr.json(), nr.json()]);
      setJobsBadge(jd.count ?? 0);
      setNotifBadge(nd.count ?? 0);
    } catch { /* backend may not be up yet */ }
  }, []);

  useEffect(() => {
    fetchBadges();
    const interval = setInterval(fetchBadges, 30_000);
    return () => clearInterval(interval);
  }, [fetchBadges]);

  return (
    <nav className="sj-sidebar">
      <div className="sj-logo">
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>SJ</span>
      </div>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`sj-nav-icon ${active === item.id ? "active" : ""}`}
          onClick={() => onNavigate(item.id)}
          title={item.label}
          style={{ position: "relative" }}
        >
          {item.icon}
          {item.id === "notifications" && notifBadge > 0 && (
            <span style={{
              position: "absolute", top: 4, right: 4,
              background: "#f87171", color: "#fff",
              fontSize: 8, fontWeight: 700, borderRadius: "50%",
              width: 12, height: 12, display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }}>
              {notifBadge > 9 ? "9+" : notifBadge}
            </span>
          )}
          {item.id === "jobs" && jobsBadge > 0 && (
            <span style={{
              position: "absolute", top: 4, right: 4,
              background: "#f87171", color: "#fff",
              fontSize: 8, fontWeight: 700, borderRadius: "50%",
              width: 12, height: 12, display: "flex", alignItems: "center", justifyContent: "center",
              pointerEvents: "none",
            }}>
              {jobsBadge > 9 ? "9+" : jobsBadge}
            </span>
          )}
        </button>
      ))}

      <div className="sj-nav-divider" style={{ marginTop: "auto" }} />

      <button
        className={`sj-nav-icon ${active === "settings" ? "active" : ""}`}
        onClick={() => onNavigate("settings")}
        title="Settings"
      >
        <Settings size={16} />
      </button>

      <div className="sj-avatar">JZ</div>
    </nav>
  );
}
