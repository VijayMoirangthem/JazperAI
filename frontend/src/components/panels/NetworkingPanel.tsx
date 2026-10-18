"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, RefreshCw, ExternalLink, ChevronDown } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface Contact {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  relationship_type: string;
  outreach_status: string;
  outreach_notes: string;
  outreach_at: string | null;
  last_contact_at: string | null;
}

interface Pipeline { none: number; contacted: number; replied: number; warm: number; referred: number }

const OUTREACH_STAGES = ["none", "contacted", "replied", "warm", "referred"] as const;
type OutreachStage = typeof OUTREACH_STAGES[number];

const STAGE_META: Record<OutreachStage, { label: string; color: string }> = {
  none:      { label: "Not contacted", color: "#6b7280" },
  contacted: { label: "Contacted",     color: "#3b82f6" },
  replied:   { label: "Replied",       color: "#f59e0b" },
  warm:      { label: "Warm lead",     color: "#22c55e" },
  referred:  { label: "Referred",      color: "#8b5cf6" },
};

const REL_LABELS: Record<string, string> = {
  recruiter: "Recruiter", hiring_manager: "Hiring Mgr",
  connection: "Connection", colleague: "Colleague", other: "Other",
};

function OutreachBadge({ status }: { status: string }) {
  const m = STAGE_META[status as OutreachStage] || STAGE_META.none;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--r-full)",
      background: `${m.color}18`, border: `1px solid ${m.color}44`, color: m.color,
    }}>
      {m.label}
    </span>
  );
}

function fmtDate(ts: string | null) {
  if (!ts) return "never";
  const d   = new Date(ts);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function NetworkingPanel() {
  const toast = useToast();
  const [contacts, setContacts]   = useState<Contact[]>([]);
  const [pipeline, setPipeline]   = useState<Pipeline | null>(null);
  const [loading, setLoading]     = useState(true);
  const [filter, setFilter]       = useState<OutreachStage | "all">("all");
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/contacts/networking`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setContacts(data.contacts || []);
      setPipeline(data.pipeline || null);
    } catch { /* silent */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function updateOutreach(id: string, outreach_status: OutreachStage, outreach_notes = "") {
    setUpdatingId(id);
    try {
      const res = await fetch(`${API}/api/contacts/${id}/outreach`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outreach_status, outreach_notes }),
      });
      if (!res.ok) throw new Error();
      setContacts(prev => prev.map(c => c.id === id ? { ...c, outreach_status, outreach_notes } : c));
      toast(`${STAGE_META[outreach_status].label} — status updated`, "success");
    } catch { toast("Failed to update status", "error"); } finally {
      setUpdatingId(null);
    }
  }

  const visible = filter === "all"
    ? contacts
    : contacts.filter(c => c.outreach_status === filter);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Users size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Networking Pipeline</span>
        <button
          onClick={load}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
        >
          <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
        </button>
      </div>

      {/* Pipeline summary */}
      {pipeline && (
        <div style={{ display: "flex", gap: 1, flexShrink: 0, borderBottom: "var(--border)", overflow: "hidden" }}>
          {OUTREACH_STAGES.filter(s => s !== "none").map(s => {
            const m = STAGE_META[s];
            const n = pipeline[s];
            return (
              <div
                key={s}
                onClick={() => setFilter(f => f === s ? "all" : s)}
                style={{
                  flex: 1, padding: "var(--sp-2)", textAlign: "center", cursor: "pointer",
                  background: filter === s ? `${m.color}18` : "none",
                  borderBottom: filter === s ? `2px solid ${m.color}` : "2px solid transparent",
                  transition: "all 0.15s",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 700, color: n > 0 ? m.color : "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>{n}</div>
                <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m.label}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0, overflowX: "auto" }}>
        {(["all", ...OUTREACH_STAGES] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "4px 10px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
            border: "none", cursor: "pointer", flexShrink: 0, textTransform: "capitalize",
            background: filter === f ? "var(--color-surface-raised)" : "none",
            color: filter === f ? "var(--color-text)" : "var(--color-text-muted)",
          }}>
            {f === "all" ? `All (${contacts.length})` : STAGE_META[f].label}
          </button>
        ))}
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>🤝</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              {filter === "all"
                ? "No contacts in your networking pipeline yet. Add recruiters and hiring managers in Contacts."
                : `No contacts with "${STAGE_META[filter as OutreachStage].label}" status.`}
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {visible.map(c => (
              <div key={c.id} style={{ borderBottom: "1px solid var(--color-border-lo)" }}>
                {/* Row */}
                <div
                  onClick={() => setExpanded(e => e === c.id ? null : c.id)}
                  style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-3)", cursor: "pointer" }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: "var(--r-full)", flexShrink: 0,
                    background: "var(--color-surface-raised)", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 600, color: "var(--color-accent)",
                  }}>
                    {c.name[0]?.toUpperCase()}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}>{c.name}</div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[c.title, c.company].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
                    <OutreachBadge status={c.outreach_status || "none"} />
                    <span style={{ fontSize: 9, color: "var(--color-text-muted)" }}>
                      {fmtDate(c.outreach_at || c.last_contact_at)}
                    </span>
                  </div>
                  <ChevronDown
                    size={12}
                    style={{ color: "var(--color-icon)", flexShrink: 0, transform: expanded === c.id ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
                  />
                </div>

                {/* Expanded */}
                {expanded === c.id && (
                  <div style={{ padding: "0 var(--sp-3) var(--sp-3)", paddingLeft: 52 }}>
                    {/* Actions */}
                    <div style={{ display: "flex", gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: "var(--sp-2)" }}>
                      {OUTREACH_STAGES.filter(s => s !== (c.outreach_status || "none")).map(s => (
                        <button
                          key={s}
                          onClick={() => updateOutreach(c.id, s)}
                          disabled={updatingId === c.id}
                          style={{
                            fontSize: 10, padding: "3px 9px", borderRadius: "var(--r-sm)",
                            border: `1px solid ${STAGE_META[s].color}44`,
                            background: `${STAGE_META[s].color}12`,
                            color: STAGE_META[s].color, cursor: "pointer", fontWeight: 500,
                          }}
                        >
                          → {STAGE_META[s].label}
                        </button>
                      ))}
                    </div>

                    {/* Links */}
                    <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                      {c.email && (
                        <button
                          onClick={() => {
                            localStorage.setItem("sj_compose_prefill", JSON.stringify({ to: c.email, subject: `Following up — ${c.name}` }));
                            window.location.hash = "compose";
                          }}
                          style={{ fontSize: 10, color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer", padding: 0 }}
                        >
                          ✉ Email
                        </button>
                      )}
                      {c.linkedin_url && (
                        <a href={c.linkedin_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "var(--color-accent)", display: "flex", alignItems: "center", gap: 2 }}>
                          <ExternalLink size={9} /> LinkedIn
                        </a>
                      )}
                      <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                        {REL_LABELS[c.relationship_type] || c.relationship_type}
                      </span>
                    </div>

                    {c.outreach_notes && (
                      <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "var(--sp-2)", lineHeight: 1.5 }}>
                        {c.outreach_notes}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
