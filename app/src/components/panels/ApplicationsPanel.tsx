"use client";

import { useState, useEffect, useCallback } from "react";
import { BriefcaseBusiness, RefreshCw, X, ExternalLink } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Application {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string;
  work_mode: string;
  status: string;
  applied_at: string;
  cover_letter_name: string;
  notes: string;
  cover_letter?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COLUMNS: { id: string; label: string; color: string }[] = [
  { id: "applied",   label: "Applied",   color: "#6366f1" },
  { id: "viewed",    label: "Viewed",    color: "#f59e0b" },
  { id: "response",  label: "Response",  color: "#3b82f6" },
  { id: "interview", label: "Interview", color: "#8b5cf6" },
  { id: "offer",     label: "Offer",     color: "#22c55e" },
  { id: "rejected",  label: "Rejected",  color: "#6b7280" },
];

const STATUSES = COLUMNS.map(c => c.id);

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysAgo(dateStr: string): string {
  if (!dateStr) return "";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "1d ago";
  return `${diff}d ago`;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// ── App Card ──────────────────────────────────────────────────────────────────

function AppCard({ app, onOpen }: { app: Application; onOpen: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onOpen}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "10px 12px",
        borderRadius: "var(--r-sm)",
        background: hovered ? "var(--color-surface-float)" : "var(--color-bg)",
        border: "var(--border)",
        cursor: "pointer",
        transition: "background 0.1s",
      }}
    >
      {/* Company + CL badge */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, marginBottom: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-text)", lineHeight: 1.3 }}>
          {app.company}
        </span>
        {app.cover_letter && (
          <span style={{
            fontSize: 9, fontWeight: 700, color: "#22c55e",
            background: "#22c55e22", border: "1px solid #22c55e44",
            borderRadius: "var(--r-full)", padding: "1px 5px",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>
            ✓ CL
          </span>
        )}
      </div>

      {/* Title */}
      <p style={{
        fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 6px",
        lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {app.title}
      </p>

      {/* Location + work_mode chips */}
      {(app.location || app.work_mode) && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 4 }}>
          {app.location && (
            <span style={{
              fontSize: 10, color: "var(--color-text-muted)",
              background: "var(--color-surface-raised)", border: "var(--border)",
              borderRadius: 4, padding: "1px 5px",
            }}>
              {app.location}
            </span>
          )}
          {app.work_mode && (
            <span style={{
              fontSize: 10, color: "var(--color-text-muted)",
              background: "var(--color-surface-raised)", border: "var(--border)",
              borderRadius: 4, padding: "1px 5px",
            }}>
              {app.work_mode}
            </span>
          )}
        </div>
      )}

      {/* Applied date */}
      <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: 0, opacity: 0.6 }}>
        {daysAgo(app.applied_at)}
      </p>
    </div>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────

function DetailDrawer({
  app,
  notes,
  onNotesChange,
  onClose,
  onStatusChange,
  onNotesSave,
}: {
  app: Application;
  notes: string;
  onNotesChange: (v: string) => void;
  onClose: () => void;
  onStatusChange: (status: string) => void;
  onNotesSave: () => void;
}) {
  return (
    <div style={{
      position: "fixed", right: 0, top: 0,
      height: "100vh", width: "min(400px, 90vw)",
      background: "var(--color-bg)", borderLeft: "var(--border)",
      zIndex: 500, padding: 24, overflowY: "auto",
      boxShadow: "-4px 0 24px rgba(0,0,0,0.25)",
    }}>
      {/* Close */}
      <button
        onClick={onClose}
        style={{
          position: "absolute", top: 16, right: 16,
          background: "none", border: "none", cursor: "pointer",
          color: "var(--color-text-muted)", display: "flex", alignItems: "center",
        }}
      >
        <X size={16} />
      </button>

      {/* Header */}
      <div style={{ marginBottom: 20, paddingRight: 28 }}>
        <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 4, color: "var(--color-text)", margin: 0 }}>
          {app.company}
        </p>
        <p style={{ fontSize: 13, color: "var(--color-text-muted)", margin: "4px 0 0" }}>
          {app.title}
        </p>
      </div>

      {/* Status / Move to */}
      <div style={{ marginBottom: 16 }}>
        <p style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--color-text-muted)", marginBottom: 6, textTransform: "uppercase",
        }}>
          Move to →
        </p>
        <select
          className="sj-input"
          value={app.status}
          onChange={(e) => onStatusChange(e.target.value)}
          style={{ width: "100%" }}
        >
          {STATUSES.map(s => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      </div>

      {/* Meta */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, fontSize: 12 }}>
        {app.applied_at && (
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--color-text-muted)", width: 90, flexShrink: 0 }}>Applied</span>
            <span>{fmtDate(app.applied_at)}</span>
          </div>
        )}
        {app.location && (
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--color-text-muted)", width: 90, flexShrink: 0 }}>Location</span>
            <span>{app.location}</span>
          </div>
        )}
        {app.work_mode && (
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--color-text-muted)", width: 90, flexShrink: 0 }}>Work Mode</span>
            <span style={{ textTransform: "capitalize" }}>{app.work_mode}</span>
          </div>
        )}
        {app.cover_letter_name && (
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ color: "var(--color-text-muted)", width: 90, flexShrink: 0 }}>CL Template</span>
            <span>{app.cover_letter_name}</span>
          </div>
        )}
      </div>

      {/* URL */}
      {app.url && (
        <div style={{ marginBottom: 16 }}>
          <a
            href={app.url}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 12, color: "var(--color-accent)", textDecoration: "none",
            }}
          >
            <ExternalLink size={11} /> View Job Posting
          </a>
        </div>
      )}

      {/* Notes */}
      <div style={{ marginBottom: 16 }}>
        <p style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
          color: "var(--color-text-muted)", marginBottom: 6, textTransform: "uppercase",
        }}>
          Notes
        </p>
        <textarea
          className="sj-input"
          rows={4}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          onBlur={onNotesSave}
          placeholder="Add notes…"
          style={{ width: "100%", resize: "vertical", boxSizing: "border-box" }}
        />
        <p style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4, opacity: 0.6 }}>
          Auto-saves on blur
        </p>
      </div>

      {/* Cover Letter */}
      {app.cover_letter && (
        <div>
          <p style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
            color: "var(--color-text-muted)", marginBottom: 6, textTransform: "uppercase",
          }}>
            Cover Letter
          </p>
          <pre style={{
            fontSize: 11, fontFamily: "monospace",
            borderRadius: "var(--r-sm)", border: "var(--border)",
            padding: 12, whiteSpace: "pre-wrap",
            background: "var(--color-surface-raised)", color: "var(--color-text)",
            maxHeight: 300, overflowY: "auto", margin: 0,
          }}>
            {app.cover_letter}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function ApplicationsPanel() {
  const [apps, setApps]       = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Application | null>(null);
  const [drawerNotes, setDrawerNotes] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/apply/applications?limit=200`);
      if (r.ok) setApps(await r.json());
    } catch { /* backend may not be ready */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCard(app: Application) {
    setSelected(app);
    setDrawerNotes(app.notes || "");
  }

  async function updateStatus(id: string, status: string) {
    try {
      await fetch(`${API}/api/apply/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch { /* silent */ }
    setApps(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    setSelected(prev => (prev && prev.id === id) ? { ...prev, status } : prev);
  }

  async function saveNotes(id: string, notes: string) {
    try {
      await fetch(`${API}/api/apply/applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
    } catch { /* silent */ }
    setApps(prev => prev.map(a => a.id === id ? { ...a, notes } : a));
    setSelected(prev => (prev && prev.id === id) ? { ...prev, notes } : prev);
  }

  // Stats
  const total         = apps.length;
  const active        = apps.filter(a => ["applied", "viewed", "response", "interview"].includes(a.status)).length;
  const interviewCnt  = apps.filter(a => ["interview", "offer"].includes(a.status)).length;
  const offerCnt      = apps.filter(a => a.status === "offer").length;
  const interviewRate = total > 0 ? Math.round((interviewCnt / total) * 100) : 0;
  const offerRate     = total > 0 ? Math.round((offerCnt / total) * 100) : 0;

  return (
    <div className="sj-panel" style={{ height: "100%", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div className="sj-panel-header">
        <BriefcaseBusiness size={13} style={{ color: "var(--color-accent)" }} />
        <span className="sj-label">Applications</span>
        <span style={{
          fontSize: 10, background: "var(--color-surface-raised)", border: "var(--border)",
          borderRadius: "var(--r-full)", padding: "1px 7px", color: "var(--color-text-muted)",
        }}>
          {total}
        </span>
        <button
          onClick={load}
          disabled={loading}
          title="Refresh"
          style={{
            background: "none", border: "none", cursor: "pointer",
            marginLeft: "auto", color: "var(--color-text-muted)",
            display: "flex", alignItems: "center",
          }}
        >
          <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
        </button>
      </div>

      {/* Stats bar */}
      <div style={{
        display: "flex", gap: 6, padding: "8px 16px",
        borderBottom: "var(--border)", flexShrink: 0, flexWrap: "wrap",
      }}>
        {[
          { label: `${total} Total`,             color: "var(--color-text-muted)" },
          { label: `${active} Active`,            color: "#6366f1" },
          { label: `${interviewRate}% Interview`, color: "#8b5cf6" },
          { label: `${offerRate}% Offer`,         color: "#22c55e" },
        ].map(({ label, color }) => (
          <span key={label} style={{
            fontSize: 10, padding: "2px 9px",
            borderRadius: "var(--r-full)",
            border: `1px solid ${color === "var(--color-text-muted)" ? "var(--color-border)" : color + "44"}`,
            color,
            background: color === "var(--color-text-muted)" ? "var(--color-surface-raised)" : color + "11",
            fontWeight: 600, whiteSpace: "nowrap",
          }}>
            {label}
          </span>
        ))}
      </div>

      {/* Board */}
      <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden" }}>
        <div style={{
          display: "flex", gap: 12, padding: "12px 16px",
          height: "100%", minWidth: "max-content", boxSizing: "border-box",
        }}>
          {COLUMNS.map(col => {
            const colApps = apps.filter(a => a.status === col.id);
            return (
              <div key={col.id} style={{
                width: 280, flexShrink: 0,
                display: "flex", flexDirection: "column",
                background: "var(--color-surface-raised)",
                borderRadius: "var(--r-md)", border: "var(--border)",
                overflow: "hidden",
              }}>
                {/* Column header */}
                <div style={{
                  padding: "10px 12px", borderBottom: "var(--border)",
                  display: "flex", alignItems: "center", gap: 8,
                  background: col.color + "15",
                  borderTop: `2px solid ${col.color}`,
                }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: col.color, flex: 1 }}>
                    {col.label}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    background: col.color + "33", color: col.color,
                    borderRadius: "var(--r-full)", padding: "1px 7px",
                  }}>
                    {colApps.length}
                  </span>
                </div>

                {/* Cards list */}
                <div style={{
                  flex: 1, overflowY: "auto", padding: 8,
                  display: "flex", flexDirection: "column", gap: 6,
                }}>
                  {colApps.map(app => (
                    <AppCard key={app.id} app={app} onOpen={() => openCard(app)} />
                  ))}
                  {colApps.length === 0 && (
                    <div style={{
                      textAlign: "center", color: "var(--color-text-muted)",
                      fontSize: 11, marginTop: 24, opacity: 0.4,
                    }}>
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail drawer */}
      {selected && (
        <DetailDrawer
          app={selected}
          notes={drawerNotes}
          onNotesChange={setDrawerNotes}
          onClose={() => setSelected(null)}
          onStatusChange={(status) => updateStatus(selected.id, status)}
          onNotesSave={() => saveNotes(selected.id, drawerNotes)}
        />
      )}
    </div>
  );
}
