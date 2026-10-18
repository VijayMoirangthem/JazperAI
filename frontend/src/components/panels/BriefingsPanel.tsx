"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Send, Clock, RefreshCw, CheckCircle, XCircle, Eye } from "lucide-react";

const API = "http://localhost:8000/api/briefings";

interface BriefingConfig {
  morning_enabled:  boolean;
  morning_hour:     number;
  morning_minute:   number;
  evening_enabled:  boolean;
  evening_hour:     number;
  evening_minute:   number;
  include_calendar: boolean;
  include_email:    boolean;
  include_jobs:     boolean;
  last_morning_sent_at: string | null;
  last_evening_sent_at: string | null;
}

interface HistoryEntry {
  id:          number;
  type:        string;
  message:     string;
  sent_at:     string | null;
  char_count:  number;
  delivery_ok: boolean;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

function utcToDisplay(h: number, m: number) {
  // Show UTC time + IST equivalent
  const istH = (h + 5) % 24;
  const istM = m + 30 >= 60 ? m - 30 : m + 30;
  const istHfinal = m + 30 >= 60 ? (istH + 1) % 24 : istH;
  return `${pad(h)}:${pad(m)} UTC  (${pad(istHfinal)}:${pad(istM)} IST)`;
}

function relativeTime(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3600000);
  if (diffH < 1) return "< 1 hour ago";
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

export function BriefingsPanel() {
  const [cfg, setCfg]           = useState<BriefingConfig | null>(null);
  const [saving, setSaving]     = useState(false);
  const [history, setHistory]   = useState<HistoryEntry[]>([]);
  const [sending, setSending]   = useState<"morning" | "evening" | null>(null);
  const [preview, setPreview]   = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<"morning" | "evening" | null>(null);
  const [expandId, setExpandId] = useState<number | null>(null);

  useEffect(() => {
    fetch(`${API}/config`).then(r => r.json()).then(setCfg).catch(() => {});
    fetch(`${API}/history?limit=8`).then(r => r.json()).then(setHistory).catch(() => {});
  }, []);

  async function save(patch: Partial<BriefingConfig>) {
    if (!cfg) return;
    const next = { ...cfg, ...patch };
    setCfg(next);
    setSaving(true);
    try {
      await fetch(`${API}/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } finally {
      setSaving(false);
    }
  }

  async function sendNow(type: "morning" | "evening") {
    setSending(type);
    setPreview(null);
    try {
      const r = await fetch(`${API}/send-now?briefing_type=${type}`, { method: "POST" });
      const data = await r.json();
      if (data.message) setPreview(data.message);
      // Refresh history
      fetch(`${API}/history?limit=8`).then(r => r.json()).then(setHistory).catch(() => {});
    } finally {
      setSending(null);
    }
  }

  async function previewBriefing(type: "morning" | "evening") {
    setPreviewing(type);
    setPreview(null);
    try {
      const r = await fetch(`${API}/preview?briefing_type=${type}`);
      const data = await r.json();
      if (data.message) setPreview(data.message);
    } finally {
      setPreviewing(null);
    }
  }

  if (!cfg) {
    return (
      <div className="sj-panel" style={{ padding: 24, color: "var(--color-muted)" }}>
        Loading briefing settings…
      </div>
    );
  }

  return (
    <div className="sj-panel" style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Clock size={16} style={{ color: "var(--color-accent)" }} />
        <span className="sj-heading" style={{ fontSize: 15 }}>Scheduled Briefings</span>
        {saving && <span style={{ fontSize: 11, color: "var(--color-muted)", marginLeft: "auto" }}>Saving…</span>}
      </div>

      {/* ── What's included ───────────────────────────────────────── */}
      <section>
        <p className="sj-subheading" style={{ fontSize: 11, marginBottom: 10 }}>INCLUDES</p>
        <div style={{ display: "flex", gap: 12 }}>
          {(["include_calendar", "include_email", "include_jobs"] as const).map(key => {
            const labels: Record<string, string> = {
              include_calendar: "📅 Calendar",
              include_email:    "📬 Email",
              include_jobs:     "💼 Jobs",
            };
            return (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={cfg[key]}
                  onChange={e => save({ [key]: e.target.checked })}
                  style={{ accentColor: "var(--color-accent)" }}
                />
                <span style={{ fontSize: 12 }}>{labels[key]}</span>
              </label>
            );
          })}
        </div>
      </section>

      {/* ── Morning briefing ──────────────────────────────────────── */}
      <BriefingSlot
        icon={<Sun size={14} />}
        label="Morning Briefing"
        enabled={cfg.morning_enabled}
        hour={cfg.morning_hour}
        minute={cfg.morning_minute}
        lastSent={cfg.last_morning_sent_at}
        type="morning"
        sending={sending === "morning"}
        previewing={previewing === "morning"}
        onToggle={v => save({ morning_enabled: v })}
        onTimeChange={(h, m) => save({ morning_hour: h, morning_minute: m })}
        onSendNow={() => sendNow("morning")}
        onPreview={() => previewBriefing("morning")}
      />

      {/* ── Evening briefing ──────────────────────────────────────── */}
      <BriefingSlot
        icon={<Moon size={14} />}
        label="Evening Wrap-up"
        enabled={cfg.evening_enabled}
        hour={cfg.evening_hour}
        minute={cfg.evening_minute}
        lastSent={cfg.last_evening_sent_at}
        type="evening"
        sending={sending === "evening"}
        previewing={previewing === "evening"}
        onToggle={v => save({ evening_enabled: v })}
        onTimeChange={(h, m) => save({ evening_hour: h, evening_minute: m })}
        onSendNow={() => sendNow("evening")}
        onPreview={() => previewBriefing("evening")}
      />

      {/* ── Preview pane ──────────────────────────────────────────── */}
      {preview && (
        <section>
          <p className="sj-subheading" style={{ fontSize: 11, marginBottom: 8 }}>PREVIEW</p>
          <div style={{
            background:  "var(--color-bg-elevated, #1a1a2e)",
            border:      "1px solid var(--color-border)",
            borderRadius: 8,
            padding:     16,
            fontSize:    13,
            lineHeight:  1.6,
            whiteSpace:  "pre-wrap",
            fontFamily:  "var(--font-mono, monospace)",
          }}>
            {preview}
          </div>
        </section>
      )}

      {/* ── History ───────────────────────────────────────────────── */}
      {history.length > 0 && (
        <section>
          <p className="sj-subheading" style={{ fontSize: 11, marginBottom: 10 }}>RECENT</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {history.map(h => (
              <div key={h.id}>
                <div
                  onClick={() => setExpandId(expandId === h.id ? null : h.id)}
                  style={{
                    display:      "flex",
                    alignItems:   "center",
                    gap:          8,
                    padding:      "8px 12px",
                    background:   "var(--color-bg-elevated, #1a1a2e)",
                    border:       "1px solid var(--color-border)",
                    borderRadius: 6,
                    cursor:       "pointer",
                  }}
                >
                  {h.type === "morning"
                    ? <Sun  size={12} style={{ color: "#facc15" }} />
                    : <Moon size={12} style={{ color: "#818cf8" }} />}
                  <span style={{ fontSize: 12, textTransform: "capitalize" }}>{h.type}</span>
                  <span style={{ fontSize: 11, color: "var(--color-muted)", marginLeft: "auto" }}>
                    {relativeTime(h.sent_at)}
                  </span>
                  {h.delivery_ok
                    ? <CheckCircle size={11} style={{ color: "#22c55e" }} />
                    : <XCircle     size={11} style={{ color: "#ef4444" }} />}
                </div>
                {expandId === h.id && (
                  <div style={{
                    padding:      "10px 12px",
                    background:   "var(--color-bg-elevated, #1a1a2e)",
                    border:       "1px solid var(--color-border)",
                    borderTop:    "none",
                    borderRadius: "0 0 6px 6px",
                    fontSize:    12,
                    lineHeight:  1.6,
                    whiteSpace:  "pre-wrap",
                    fontFamily:  "var(--font-mono, monospace)",
                  }}>
                    {h.message}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <p style={{ fontSize: 11, color: "var(--color-muted)", marginTop: "auto" }}>
        All times are UTC. Telegram must be configured in Settings → Telegram for delivery to work.
      </p>
    </div>
  );
}

interface SlotProps {
  icon:        React.ReactNode;
  label:       string;
  enabled:     boolean;
  hour:        number;
  minute:      number;
  lastSent:    string | null;
  type:        "morning" | "evening";
  sending:     boolean;
  previewing:  boolean;
  onToggle:    (v: boolean) => void;
  onTimeChange:(h: number, m: number) => void;
  onSendNow:   () => void;
  onPreview:   () => void;
}

function BriefingSlot({
  icon, label, enabled, hour, minute, lastSent,
  sending, previewing, onToggle, onTimeChange, onSendNow, onPreview,
}: SlotProps) {
  return (
    <section style={{
      border:       "1px solid var(--color-border)",
      borderRadius: 8,
      padding:      16,
      background:   enabled ? "var(--color-bg-elevated, #1a1a2e)" : "transparent",
      opacity:      enabled ? 1 : 0.6,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: enabled ? 14 : 0 }}>
        <span style={{ color: "var(--color-accent)" }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <span style={{ fontSize: 11, color: "var(--color-muted)" }}>{enabled ? "ON" : "OFF"}</span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => onToggle(e.target.checked)}
            style={{ accentColor: "var(--color-accent)" }}
          />
        </label>
      </div>

      {enabled && (
        <>
          {/* Time picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Clock size={12} style={{ color: "var(--color-muted)" }} />
            <select
              value={hour}
              onChange={e => onTimeChange(Number(e.target.value), minute)}
              style={{
                background: "var(--color-bg)", border: "1px solid var(--color-border)",
                borderRadius: 4, padding: "4px 8px", fontSize: 12, color: "var(--color-fg)",
              }}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{pad(i)}</option>
              ))}
            </select>
            <span style={{ fontSize: 13 }}>:</span>
            <select
              value={minute}
              onChange={e => onTimeChange(hour, Number(e.target.value))}
              style={{
                background: "var(--color-bg)", border: "1px solid var(--color-border)",
                borderRadius: 4, padding: "4px 8px", fontSize: 12, color: "var(--color-fg)",
              }}
            >
              {[0, 15, 30, 45].map(m => (
                <option key={m} value={m}>{pad(m)}</option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
              {utcToDisplay(hour, minute)}
            </span>
          </div>

          {/* Last sent */}
          <p style={{ fontSize: 11, color: "var(--color-muted)", marginBottom: 12 }}>
            Last sent: {relativeTime(lastSent)}
          </p>

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={onPreview}
              disabled={!!previewing}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 5, fontSize: 12,
                background: "var(--color-bg)", border: "1px solid var(--color-border)",
                cursor: previewing ? "not-allowed" : "pointer", color: "var(--color-fg)",
                opacity: previewing ? 0.5 : 1,
              }}
            >
              {previewing
                ? <RefreshCw size={11} className="sj-spin" />
                : <Eye size={11} />}
              Preview
            </button>
            <button
              onClick={onSendNow}
              disabled={!!sending}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "5px 12px", borderRadius: 5, fontSize: 12,
                background: "var(--color-accent)", border: "none",
                cursor: sending ? "not-allowed" : "pointer", color: "#fff",
                opacity: sending ? 0.5 : 1,
              }}
            >
              {sending
                ? <RefreshCw size={11} className="sj-spin" />
                : <Send size={11} />}
              Send Now
            </button>
          </div>
        </>
      )}
    </section>
  );
}
