"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Mail, RefreshCw, Search, Send, Volume2, VolumeX,
  Loader2, ChevronLeft, PenLine, X, CheckCircle,
  AlertCircle, Star, Tag, Users, Bell, MessageSquare,
  Trash2, AlertTriangle, BookMarked, Sparkles, Inbox,
  ArrowUpRight, Archive, MailOpen, Forward, Zap,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface EmailSummary {
  id: string;
  thread_id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  unread: boolean;
}

interface EmailFull extends EmailSummary {
  body: string;
  labels: string[];
}

interface GmailProfile {
  email: string;
  messages_total: number;
  threads_total: number;
}

interface ConnectedAccount {
  email: string;
  connected_at: string | null;
}

interface CategoryCounts {
  inbox: number;
  primary: number;
  social: number;
  promotions: number;
  updates: number;
  forums: number;
  starred: number;
  important: number;
  sent: number;
  drafts: number;
  spam: number;
  trash: number;
}

interface JazperSummary {
  summary_text: string;
  emails: EmailSummary[];
  counts: CategoryCounts;
  total_unread: number;
}

// ── Category definitions ──────────────────────────────────────────────────────

type CategoryId =
  | "primary" | "social" | "promotions" | "updates" | "forums"
  | "starred" | "important" | "sent" | "drafts" | "spam" | "trash";

interface Category {
  id: CategoryId;
  label: string;
  gmailLabel: string;   // label passed to /inbox?label=
  icon: React.ReactNode;
  color: string;
  group: "main" | "system";
}

const CATEGORIES: Category[] = [
  // Main tabs (top row — matches Gmail's tabbed inbox)
  { id: "primary",    label: "Primary",    gmailLabel: "CATEGORY_PERSONAL",  icon: <Inbox size={12} />,       color: "#60a5fa", group: "main" },
  { id: "social",     label: "Social",     gmailLabel: "CATEGORY_SOCIAL",    icon: <Users size={12} />,       color: "#a78bfa", group: "main" },
  { id: "promotions", label: "Promotions", gmailLabel: "CATEGORY_PROMOTIONS",icon: <Tag size={12} />,         color: "#f59e0b", group: "main" },
  { id: "updates",    label: "Updates",    gmailLabel: "CATEGORY_UPDATES",   icon: <Bell size={12} />,        color: "#34d399", group: "main" },
  { id: "forums",     label: "Forums",     gmailLabel: "CATEGORY_FORUMS",    icon: <MessageSquare size={12} />,color: "#fb923c", group: "main" },
  // System folders (left sidebar style)
  { id: "starred",    label: "Starred",    gmailLabel: "STARRED",            icon: <Star size={12} />,        color: "#facc15", group: "system" },
  { id: "important",  label: "Important",  gmailLabel: "IMPORTANT",          icon: <BookMarked size={12} />,  color: "#f87171", group: "system" },
  { id: "sent",       label: "Sent",       gmailLabel: "SENT",               icon: <ArrowUpRight size={12} />,color: "#94a3b8", group: "system" },
  { id: "drafts",     label: "Drafts",     gmailLabel: "DRAFTS",             icon: <PenLine size={12} />,     color: "#94a3b8", group: "system" },
  { id: "spam",       label: "Spam",       gmailLabel: "SPAM",               icon: <AlertTriangle size={12} />,color: "#f87171", group: "system" },
  { id: "trash",      label: "Trash",      gmailLabel: "TRASH",              icon: <Trash2 size={12} />,      color: "#64748b", group: "system" },
];

const CAT_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, Category>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays < 7)
    return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function senderName(from: string) {
  const m = from.match(/^"?([^"<]+)"?\s*</);
  return m ? m[1].trim() : from.replace(/<[^>]+>/, "").trim() || from;
}

function badge(count: number, color: string) {
  if (!count) return null;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, background: color + "33",
      color, border: `1px solid ${color}55`, borderRadius: 8,
      padding: "1px 5px", marginLeft: 4, flexShrink: 0,
    }}>
      {count > 999 ? "999+" : count}
    </span>
  );
}

// ── TTS hook ──────────────────────────────────────────────────────────────────

function useTTS() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function speak(text: string) {
    if (speaking) { stop(); return; }
    const cleaned = text.replace(/\s+/g, " ").trim().slice(0, 4000);
    if (!cleaned) return;
    setSpeaking(true);
    try {
      const res = await fetch(`${API}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleaned, voice: "en-US-AriaNeural" }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => setSpeaking(false);
      audio.play();
    } catch { setSpeaking(false); }
  }

  function stop() { audioRef.current?.pause(); setSpeaking(false); }
  return { speaking, speak, stop };
}

// ── Connect screen ────────────────────────────────────────────────────────────

function ConnectGmail() {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 32 }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--color-surface)", border: "1px solid var(--color-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Mail size={28} style={{ color: "var(--color-text-dim)" }} />
      </div>
      <div style={{ textAlign: "center" }}>
        <p style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Connect your Gmail</p>
        <p style={{ fontSize: 12, color: "var(--color-text-dim)", maxWidth: 320, lineHeight: 1.6 }}>
          Sir Jazper will read your emails, categorise them, and summarise your inbox on command.
          Your tokens stay in your own PostgreSQL — never leave your machine.
        </p>
      </div>
      <button className="sj-btn" style={{ padding: "10px 24px", fontSize: 13 }}
        onClick={() => { window.location.href = `${API}/api/google/oauth/authorize`; }}>
        Connect Gmail Account
      </button>
    </div>
  );
}

// ── Jazper Summary Card ───────────────────────────────────────────────────────

function JazperSummaryCard({ onClose }: { onClose: () => void }) {
  const [summary, setSummary] = useState<JazperSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const { speaking, speak, stop } = useTTS();

  useEffect(() => {
    fetch(`${API}/api/google/gmail/jazper-summary`)
      .then((r) => r.json())
      .then((d) => { setSummary(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{
      position: "absolute", top: 56, right: 12, width: 380, zIndex: 50,
      background: "var(--color-bg)", border: "1px solid var(--color-border)",
      borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
        <Sparkles size={14} style={{ color: "#facc15" }} />
        <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Jazper — Inbox Summary</span>
        <button className="sj-btn-ghost" onClick={() => { stop(); onClose(); }}><X size={13} /></button>
      </div>

      {loading ? (
        <div style={{ padding: 24, display: "flex", justifyContent: "center" }}><Loader2 size={18} className="spin" /></div>
      ) : !summary ? (
        <p style={{ padding: 16, fontSize: 12, color: "var(--color-text-dim)" }}>Could not load summary.</p>
      ) : (
        <div style={{ padding: 14 }}>
          {/* Summary text */}
          <p style={{ fontSize: 12, lineHeight: 1.7, color: "var(--color-text)", marginBottom: 12 }}>
            {summary.summary_text}
          </p>

          {/* Category count pills */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {CATEGORIES.filter((c) => c.group === "main").map((c) => {
              const count = summary.counts[c.id] ?? 0;
              if (!count) return null;
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, background: "var(--color-surface)", border: `1px solid ${c.color}44`, borderRadius: 6, padding: "3px 8px" }}>
                  <span style={{ color: c.color }}>{c.icon}</span>
                  <span>{c.label}</span>
                  <span style={{ color: c.color, fontWeight: 700 }}>{count > 999 ? "999+" : count}</span>
                </div>
              );
            })}
          </div>

          {/* Top emails */}
          {summary.emails.length > 0 && (
            <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10, marginBottom: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", marginBottom: 8 }}>IMPORTANT UNREAD</p>
              {summary.emails.map((e) => (
                <div key={e.id} style={{ marginBottom: 8, padding: "6px 8px", background: "var(--color-surface)", borderRadius: 5, borderLeft: "2px solid #f87171" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.subject}</p>
                  <p style={{ fontSize: 10, color: "var(--color-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {senderName(e.from)} · {e.snippet.slice(0, 80)}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Read aloud button */}
          <button className="sj-btn" style={{ width: "100%", justifyContent: "center" }}
            onClick={() => speaking ? stop() : speak(summary.summary_text)}>
            {speaking ? <><VolumeX size={13} /> Stop reading</> : <><Volume2 size={13} /> Read aloud</>}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Compose modal ─────────────────────────────────────────────────────────────

function ComposeModal({ onClose, replyTo }: {
  onClose: () => void;
  replyTo?: { to: string; subject: string; thread_id?: string };
}) {
  const [to, setTo]           = useState(replyTo?.to ?? "");
  const [subject, setSubject] = useState(replyTo ? `Re: ${replyTo.subject.replace(/^Re:\s*/i, "")}` : "");
  const [body, setBody]       = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);

  async function send() {
    if (!to.trim() || !subject.trim() || !body.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/api/google/gmail/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, reply_to_id: replyTo?.thread_id ?? null }),
      });
      if (res.ok) { setSent(true); setTimeout(onClose, 1200); }
    } finally { setSending(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 24, zIndex: 100 }}>
      <div style={{ width: 500, background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 8, display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{replyTo ? "Reply" : "New Message"}</span>
          <button className="sj-btn-ghost" onClick={onClose}><X size={14} /></button>
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="sj-input" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
          <input className="sj-input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="sj-input" placeholder="Write your message…" value={body} rows={10} style={{ resize: "vertical" }} onChange={(e) => setBody(e.target.value)} />
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8 }}>
          <button className="sj-btn" onClick={send} disabled={sending || sent || !to || !subject || !body}>
            {sent ? <><CheckCircle size={12} /> Sent!</> : sending ? <><Loader2 size={12} className="spin" /> Sending…</> : <><Send size={12} /> Send</>}
          </button>
          <button className="sj-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Email action helpers ──────────────────────────────────────────────────────

async function apiTrash(id: string) {
  await fetch(`${API}/api/google/gmail/email/${id}/trash`, { method: "POST" });
}
async function apiArchive(id: string) {
  await fetch(`${API}/api/google/gmail/email/${id}/archive`, { method: "POST" });
}
async function apiMark(id: string, read?: boolean, starred?: boolean) {
  await fetch(`${API}/api/google/gmail/email/${id}/mark`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ read, starred }),
  });
}

// ── Email detail ──────────────────────────────────────────────────────────────

function EmailDetail({ email, category, onBack, onAction }: {
  email: EmailFull;
  category: Category;
  onBack: () => void;
  onAction: (id: string, action: "trash" | "archive" | "star" | "read") => void;
}) {
  const { speaking, speak, stop } = useTTS();
  const [replying, setReplying] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [starring, setStarring] = useState(email.labels?.includes("STARRED") ?? false);
  const [actioning, setActioning] = useState(false);

  function readAloud() {
    const text = `Email from ${senderName(email.from)}. Subject: ${email.subject}. ${email.body}`;
    speaking ? stop() : speak(text);
  }

  async function handleTrash() {
    setActioning(true);
    await apiTrash(email.id).catch(() => {});
    onAction(email.id, "trash");
    onBack();
  }

  async function handleArchive() {
    setActioning(true);
    await apiArchive(email.id).catch(() => {});
    onAction(email.id, "archive");
    onBack();
  }

  async function handleStar() {
    const next = !starring;
    setStarring(next);
    await apiMark(email.id, undefined, next).catch(() => { setStarring(!next); });
    onAction(email.id, "star");
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", flexShrink: 0, flexWrap: "wrap" }}>
        <button className="sj-btn-ghost" onClick={onBack}><ChevronLeft size={14} /> Back</button>
        <span style={{ color: category.color, display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
          {category.icon} {category.label}
        </span>
        <div style={{ flex: 1 }} />

        {/* Action buttons */}
        <button className="sj-btn-ghost" title={starring ? "Unstar" : "Star"} onClick={handleStar}
          style={{ color: starring ? "#facc15" : undefined }}>
          <Star size={13} fill={starring ? "#facc15" : "none"} />
        </button>
        <button className="sj-btn-ghost" title="Archive" onClick={handleArchive} disabled={actioning}>
          <Archive size={13} />
        </button>
        <button className="sj-btn-ghost" title="Move to trash" onClick={handleTrash} disabled={actioning}
          style={{ color: "#f87171" }}>
          <Trash2 size={13} />
        </button>
        <button className="sj-btn-ghost" title="Forward" onClick={() => setForwarding(true)}>
          <Forward size={13} />
        </button>
        <button className="sj-btn-ghost" onClick={readAloud}>
          {speaking ? <><VolumeX size={13} /> Stop</> : <><Volume2 size={13} /> Read Aloud</>}
        </button>
        <button className="sj-btn" onClick={() => setReplying(true)}>
          <Send size={12} /> Reply
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 14, lineHeight: 1.3 }}>{email.subject}</h2>
        <div style={{ display: "flex", gap: 20, marginBottom: 20, fontSize: 12, color: "var(--color-text-dim)", flexWrap: "wrap" }}>
          <span><strong style={{ color: "var(--color-text)" }}>From</strong> {email.from}</span>
          <span><strong style={{ color: "var(--color-text)" }}>To</strong> {email.to}</span>
          <span>{email.date}</span>
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--color-text)", whiteSpace: "pre-wrap", wordBreak: "break-word", background: "var(--color-surface)", borderRadius: 6, padding: 20, border: "1px solid var(--color-border)" }}>
          {email.body || "(No content)"}
        </div>
      </div>

      {replying && <ComposeModal onClose={() => setReplying(false)} replyTo={{ to: email.from, subject: email.subject, thread_id: email.thread_id }} />}
      {forwarding && <ForwardModal msgId={email.id} onClose={() => setForwarding(false)} />}
    </div>
  );
}

// ── Forward modal ─────────────────────────────────────────────────────────────

function ForwardModal({ msgId, onClose }: { msgId: string; onClose: () => void }) {
  const [to, setTo]     = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);

  async function send() {
    if (!to.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`${API}/api/google/gmail/email/${msgId}/forward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, note }),
      });
      if (res.ok) { setSent(true); setTimeout(onClose, 1200); }
    } finally { setSending(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "flex-end", padding: 24, zIndex: 100 }}>
      <div style={{ width: 420, background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 8, display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>Forward Email</span>
          <button className="sj-btn-ghost" onClick={onClose}><X size={14} /></button>
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="sj-input" placeholder="Forward to (email address)" value={to} onChange={(e) => setTo(e.target.value)} />
          <textarea className="sj-input" placeholder="Add a note (optional)…" value={note} rows={4} style={{ resize: "vertical" }} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8 }}>
          <button className="sj-btn" onClick={send} disabled={sending || sent || !to}>
            {sent ? <><CheckCircle size={12} /> Forwarded!</> : sending ? <><Loader2 size={12} className="spin" /> Forwarding…</> : <><Forward size={12} /> Forward</>}
          </button>
          <button className="sj-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Email row ─────────────────────────────────────────────────────────────────

function EmailRow({ email, category, onClick, onTrash, onArchive, onStar }: {
  email: EmailSummary;
  category: Category;
  onClick: () => void;
  onTrash: () => void;
  onArchive: () => void;
  onStar: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "9px 12px 9px 16px", cursor: "pointer",
        borderBottom: "1px solid var(--color-border)",
        background: hovered ? "var(--color-surface)" : email.unread ? "rgba(255,255,255,0.02)" : "transparent",
      }}
    >
      {/* Unread indicator */}
      <div style={{ flexShrink: 0, width: 7 }}>
        {email.unread && <div style={{ width: 7, height: 7, borderRadius: "50%", background: category.color }} />}
      </div>

      {/* Main content — clickable */}
      <div style={{ flex: 1, minWidth: 0 }} onClick={onClick}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 2 }}>
          <span style={{ fontSize: 12, fontWeight: email.unread ? 700 : 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "65%" }}>
            {senderName(email.from)}
          </span>
          <span style={{ fontSize: 10, color: "var(--color-text-dim)", flexShrink: 0 }}>{fmt(email.date)}</span>
        </div>
        <p style={{ fontSize: 12, fontWeight: email.unread ? 600 : 400, marginBottom: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {email.subject}
        </p>
        <p style={{ fontSize: 11, color: "var(--color-text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {email.snippet}
        </p>
      </div>

      {/* Hover actions */}
      {hovered && (
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <button className="sj-btn-ghost" title="Star" style={{ padding: "3px 5px" }} onClick={onStar}>
            <Star size={12} />
          </button>
          <button className="sj-btn-ghost" title="Archive" style={{ padding: "3px 5px" }} onClick={onArchive}>
            <Archive size={12} />
          </button>
          <button className="sj-btn-ghost" title="Trash" style={{ padding: "3px 5px", color: "#f87171" }} onClick={onTrash}>
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function GmailPanel() {
  const [connected, setConnected]         = useState<ConnectedAccount[]>([]);
  const [profile, setProfile]             = useState<GmailProfile | null>(null);
  const [emails, setEmails]               = useState<EmailSummary[]>([]);
  const [selected, setSelected]           = useState<EmailFull | null>(null);
  const [category, setCategory]           = useState<CategoryId>("primary");
  const [counts, setCounts]               = useState<Partial<CategoryCounts>>({});
  const [loading, setLoading]             = useState(true);
  const [loadingEmail, setLoadingEmail]   = useState(false);
  const [loadingMore, setLoadingMore]     = useState(false);
  const [composing, setComposing]         = useState(false);
  const [showSummary, setShowSummary]     = useState(false);
  const [search, setSearch]               = useState("");
  const [searching, setSearching]         = useState(false);
  const [syncing, setSyncing]             = useState(false);
  const [nextPageToken, setNextPageToken] = useState("");
  const [fromCache, setFromCache]         = useState(false);
  const [cacheAge, setCacheAge]           = useState(0);
  const [fetchError, setFetchError]       = useState<string | null>(null);
  const [authChecked, setAuthChecked]     = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("gmail_connected")) window.history.replaceState({}, "", window.location.pathname);
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      const r = await fetch(`${API}/api/google/oauth/status`);
      const d = await r.json();
      setConnected(d.connected ?? []);
      setAuthChecked(true);
      if ((d.connected ?? []).length > 0) {
        fetchProfile();
        fetchCounts();
        fetchEmails("primary", "", false, false);
      } else {
        setLoading(false);
      }
    } catch {
      setAuthChecked(true);
      setLoading(false);
    }
  }

  async function fetchProfile() {
    try {
      const r = await fetch(`${API}/api/google/gmail/profile`);
      if (r.ok) setProfile(await r.json());
    } catch { /* ignore */ }
  }

  async function fetchCounts() {
    try {
      const r = await fetch(`${API}/api/google/gmail/counts`);
      if (r.ok) setCounts(await r.json());
    } catch { /* ignore */ }
  }

  const fetchEmails = useCallback(async (
    cat: CategoryId, pageToken = "", append = false, forceRefresh = false
  ) => {
    const catDef = CAT_MAP[cat];
    if (!append) { setLoading(true); setSelected(null); setFetchError(null); }
    else setLoadingMore(true);

    try {
      const url = `${API}/api/google/gmail/inbox?label=${catDef.gmailLabel}&limit=30${pageToken ? `&page_token=${pageToken}` : ""}${forceRefresh ? "&force_refresh=true" : ""}`;
      const r = await fetch(url);
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        setFetchError(err.detail ?? "Failed to load emails");
        return;
      }
      const d = await r.json();
      setEmails((prev) => append ? [...prev, ...(d.emails ?? [])] : (d.emails ?? []));
      setNextPageToken(d.next_page_token ?? "");
      setFromCache(d.from_cache ?? false);
      setCacheAge(d.cache_age_seconds ?? 0);
    } catch (e: unknown) {
      setFetchError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  async function switchCategory(cat: CategoryId) {
    setCategory(cat);
    setSearch("");
    setNextPageToken("");
    fetchEmails(cat);
  }

  async function doSearch() {
    if (!search.trim()) { fetchEmails(category); return; }
    setSearching(true);
    setLoading(true);
    setFetchError(null);
    try {
      const r = await fetch(`${API}/api/google/gmail/search?q=${encodeURIComponent(search)}&limit=30`);
      const d = await r.json();
      setEmails(d.emails ?? []);
      setNextPageToken(d.next_page_token ?? "");
      setFromCache(d.from_cache ?? false);
    } catch { /* ignore */ }
    finally { setLoading(false); setSearching(false); }
  }

  async function hardRefresh() {
    setSyncing(true);
    await fetch(`${API}/api/google/gmail/sync`, { method: "POST" }).catch(() => {});
    await fetchEmails(category, "", false, true);
    fetchProfile();
    fetchCounts();
    setSyncing(false);
  }

  const [aiCmd, setAiCmd]       = useState("");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResult, setAiResult]   = useState<string | null>(null);

  async function openEmail(id: string) {
    setLoadingEmail(true);
    try {
      const r = await fetch(`${API}/api/google/gmail/email/${id}?mark_read=true`);
      const d = await r.json();
      setSelected(d);
      setEmails((prev) => prev.map((e) => e.id === id ? { ...e, unread: false } : e));
    } finally { setLoadingEmail(false); }
  }

  async function runAiCommand() {
    if (!aiCmd.trim() || aiRunning) return;
    setAiRunning(true);
    setAiResult(null);
    try {
      const res = await fetch(`${API}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: aiCmd }),
      });
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buf = "";
      let out = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload === "[DONE]" || payload.startsWith("[META]") || payload.startsWith("[SEARCHING")) continue;
          out += payload.replace(/\\n/g, "\n");
        }
      }
      setAiResult(out || "Done.");
      setAiCmd("");
      // Refresh emails after action
      setTimeout(() => { fetchEmails(category, "", false, true); fetchCounts(); }, 1500);
    } catch (e) {
      setAiResult("Error running command.");
    } finally {
      setAiRunning(false);
    }
  }

  function handleEmailAction(id: string, action: "trash" | "archive" | "star" | "read") {
    if (action === "trash" || action === "archive") {
      setEmails((prev) => prev.filter((e) => e.id !== id));
    } else if (action === "star") {
      // optimistic — no visual change needed in list
    }
  }

  async function quickTrash(id: string) {
    setEmails((prev) => prev.filter((e) => e.id !== id));
    await apiTrash(id).catch(() => {});
  }

  async function quickArchive(id: string) {
    setEmails((prev) => prev.filter((e) => e.id !== id));
    await apiArchive(id).catch(() => {});
  }

  async function quickStar(id: string) {
    await apiMark(id, undefined, true).catch(() => {});
    setEmails((prev) => prev.map((e) => e.id === id ? { ...e } : e));
  }

  // ── Render guards ────────────────────────────────────────────────────────────

  if (!authChecked) {
    return (
      <div className="sj-panel" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Loader2 size={20} className="spin" />
      </div>
    );
  }

  if (connected.length === 0) {
    return <div className="sj-panel" style={{ height: "100%", padding: 0 }}><ConnectGmail /></div>;
  }

  const currentCat = CAT_MAP[category];

  if (selected) {
    return (
      <div className="sj-panel" style={{ height: "100%", padding: 0 }}>
        {loadingEmail
          ? <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}><Loader2 size={20} className="spin" /></div>
          : <EmailDetail email={selected} category={currentCat} onBack={() => setSelected(null)} onAction={handleEmailAction} />}
      </div>
    );
  }

  // ── Main layout ──────────────────────────────────────────────────────────────

  return (
    <div className="sj-panel" style={{ height: "100%", padding: 0, display: "flex", overflow: "hidden", position: "relative" }}>

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div style={{ width: 160, flexShrink: 0, borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflowY: "auto", background: "var(--color-surface)" }}>
        {/* Compose button */}
        <div style={{ padding: "10px 10px 6px" }}>
          <button className="sj-btn" style={{ width: "100%", justifyContent: "center", fontSize: 12 }}
            onClick={() => setComposing(true)}>
            <PenLine size={12} /> Compose
          </button>
        </div>

        {/* Category nav */}
        <div style={{ padding: "4px 0" }}>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", color: "var(--color-text-dim)", padding: "8px 12px 4px" }}>INBOX</p>

          {/* Main categories */}
          {CATEGORIES.filter((c) => c.group === "main").map((c) => (
            <button key={c.id} onClick={() => switchCategory(c.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, width: "100%",
                padding: "7px 12px", fontSize: 12, cursor: "pointer", background: "none",
                border: "none", borderLeft: category === c.id ? `2px solid ${c.color}` : "2px solid transparent",
                color: category === c.id ? "var(--color-text)" : "var(--color-text-dim)",
                fontWeight: category === c.id ? 700 : 400,
              }}>
              <span style={{ color: c.color }}>{c.icon}</span>
              <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
              {badge(counts[c.id] ?? 0, c.color)}
            </button>
          ))}

          <div style={{ height: 1, background: "var(--color-border)", margin: "8px 12px" }} />
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", color: "var(--color-text-dim)", padding: "4px 12px 4px" }}>FOLDERS</p>

          {/* System folders */}
          {CATEGORIES.filter((c) => c.group === "system").map((c) => (
            <button key={c.id} onClick={() => switchCategory(c.id)}
              style={{
                display: "flex", alignItems: "center", gap: 7, width: "100%",
                padding: "6px 12px", fontSize: 11, cursor: "pointer", background: "none",
                border: "none", borderLeft: category === c.id ? `2px solid ${c.color}` : "2px solid transparent",
                color: category === c.id ? "var(--color-text)" : "var(--color-text-dim)",
                fontWeight: category === c.id ? 700 : 400,
              }}>
              <span style={{ color: c.color }}>{c.icon}</span>
              <span style={{ flex: 1, textAlign: "left" }}>{c.label}</span>
              {badge(counts[c.id] ?? 0, c.color)}
            </button>
          ))}
        </div>

        {/* Profile footer */}
        {profile && (
          <div style={{ marginTop: "auto", padding: "10px 12px", borderTop: "1px solid var(--color-border)", fontSize: 10, color: "var(--color-text-dim)" }}>
            <p style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.email}</p>
            <p>{(profile.messages_total ?? 0).toLocaleString()} messages</p>
          </div>
        )}
      </div>

      {/* ── Right panel ───────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", flexShrink: 0 }}>
          {/* Search */}
          <div style={{ flex: 1, display: "flex", gap: 6 }}>
            <input className="sj-input" placeholder={`Search in ${currentCat.label}…`}
              value={search} style={{ flex: 1 }}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()} />
            <button className="sj-btn-ghost" onClick={doSearch} disabled={searching}>
              {searching ? <Loader2 size={13} className="spin" /> : <Search size={13} />}
            </button>
            {search && <button className="sj-btn-ghost" onClick={() => { setSearch(""); fetchEmails(category); }}><X size={13} /></button>}
          </div>

          {/* Cache pill */}
          {fromCache && !loading && (
            <span style={{ fontSize: 10, color: "var(--color-text-dim)", background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "2px 7px", whiteSpace: "nowrap" }}>
              cached {cacheAge < 60 ? `${cacheAge}s` : `${Math.round(cacheAge / 60)}m`} ago
            </span>
          )}

          {/* Jazper summary button */}
          <button className="sj-btn-ghost" title="Jazper inbox summary" onClick={() => setShowSummary((p) => !p)}>
            <Sparkles size={14} style={{ color: "#facc15" }} />
          </button>

          {/* Sync */}
          <button className="sj-btn-ghost" title="Sync" onClick={hardRefresh} disabled={syncing}>
            {syncing ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
          </button>
        </div>

        {/* Category header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <span style={{ color: currentCat.color }}>{currentCat.icon}</span>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{currentCat.label}</span>
          {(counts[category] ?? 0) > 0 && (
            <span style={{ fontSize: 11, color: currentCat.color, fontWeight: 600 }}>
              {counts[category]} unread
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--color-text-dim)", marginLeft: "auto" }}>
            {emails.length} loaded
          </span>
        </div>

        {/* AI command bar */}
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)", background: "var(--color-bg)", flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Zap size={13} style={{ color: "#facc15", flexShrink: 0 }} />
            <input
              className="sj-input"
              placeholder='Ask Jazper: "Archive all newsletters" · "Star emails from my boss" · "Summarize thread"…'
              value={aiCmd}
              style={{ flex: 1, fontSize: 11 }}
              onChange={(e) => setAiCmd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runAiCommand()}
            />
            <button className="sj-btn" onClick={runAiCommand} disabled={aiRunning || !aiCmd.trim()} style={{ whiteSpace: "nowrap", fontSize: 11 }}>
              {aiRunning ? <><Loader2 size={11} className="spin" /> Running…</> : "Run"}
            </button>
          </div>
          {aiResult && (
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-text)", background: "var(--color-surface)", borderRadius: 5, padding: "6px 10px", border: "1px solid var(--color-border)", lineHeight: 1.6, position: "relative" }}>
              {aiResult}
              <button className="sj-btn-ghost" style={{ position: "absolute", top: 4, right: 4, padding: 2 }} onClick={() => setAiResult(null)}><X size={10} /></button>
            </div>
          )}
        </div>

        {/* Email list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8 }}>
              <Loader2 size={22} className="spin" />
              <p style={{ fontSize: 11, color: "var(--color-text-dim)" }}>Loading {currentCat.label}…</p>
            </div>
          ) : fetchError ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 10, padding: 24 }}>
              <AlertCircle size={24} style={{ color: "#f87171" }} />
              <p style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{fetchError}</p>
              <button className="sj-btn-ghost" onClick={() => fetchEmails(category)}><RefreshCw size={12} /> Retry</button>
            </div>
          ) : emails.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8 }}>
              <span style={{ color: currentCat.color, opacity: 0.4 }}>{currentCat.icon}</span>
              <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>
                {search ? "No results found" : `${currentCat.label} is empty`}
              </p>
            </div>
          ) : (
            <>
              {emails.map((email) => (
                <EmailRow
                  key={email.id}
                  email={email}
                  category={currentCat}
                  onClick={() => openEmail(email.id)}
                  onTrash={() => quickTrash(email.id)}
                  onArchive={() => quickArchive(email.id)}
                  onStar={() => quickStar(email.id)}
                />
              ))}
              {nextPageToken && (
                <div style={{ padding: "14px 16px", textAlign: "center" }}>
                  <button className="sj-btn-ghost" onClick={() => fetchEmails(category, nextPageToken, true)}
                    disabled={loadingMore} style={{ width: "100%", justifyContent: "center" }}>
                    {loadingMore ? <><Loader2 size={12} className="spin" /> Loading…</> : "Load more emails"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Jazper summary popup */}
      {showSummary && <JazperSummaryCard onClose={() => setShowSummary(false)} />}

      {composing && <ComposeModal onClose={() => setComposing(false)} />}
    </div>
  );
}
