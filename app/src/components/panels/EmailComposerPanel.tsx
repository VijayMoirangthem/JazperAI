"use client";

import { useState, useEffect, useRef } from "react";
import { Mail, ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Send, Sparkles, Loader2 } from "lucide-react";

const API = "http://localhost:8000/api/google/gmail/send";
const DRAFT_KEY = "sj_compose_draft";

interface FormState {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

const EMPTY_FORM: FormState = { to: "", cc: "", subject: "", body: "" };

export function EmailComposerPanel() {
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [showCc, setShowCc]       = useState(false);
  const [sending, setSending]     = useState(false);
  const [improving, setImproving] = useState(false);
  const [tone, setTone]           = useState<"professional" | "friendly" | "concise">("professional");
  const [error, setError]         = useState<string | null>(null);
  const [sentTo, setSentTo]       = useState<string | null>(null);
  const [hasDraft, setHasDraft]   = useState(false);
  const [replyToId, setReplyToId] = useState<string | null>(null);
  const bodyRef                   = useRef<HTMLTextAreaElement>(null);

  async function handleImprove() {
    if (!form.body.trim()) return;
    setImproving(true);
    setError(null);
    try {
      const res = await fetch("http://localhost:8000/api/compose/improve", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: form.body, tone }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.improved) {
        handleChange("body", data.improved);
        setTimeout(() => bodyRef.current?.focus(), 50);
      }
    } catch {
      setError("Improve failed — is the backend running?");
    } finally {
      setImproving(false);
    }
  }

  // Load reply prefill OR draft from localStorage on mount
  useEffect(() => {
    try {
      // Reply prefill takes priority (set by NotificationCenterPanel "Reply" button)
      const prefillRaw = localStorage.getItem("sj_compose_prefill");
      if (prefillRaw) {
        const prefill = JSON.parse(prefillRaw) as { to?: string; subject?: string; body?: string; reply_to_id?: string };
        localStorage.removeItem("sj_compose_prefill");
        setForm(f => ({
          ...f,
          to:      prefill.to      ?? f.to,
          subject: prefill.subject ?? f.subject,
          body:    prefill.body    ?? f.body,
        }));
        if (prefill.reply_to_id) setReplyToId(prefill.reply_to_id);
        return;
      }
      // Fall back to saved draft
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<FormState>;
        const restored: FormState = {
          to:      draft.to      ?? "",
          cc:      draft.cc      ?? "",
          subject: draft.subject ?? "",
          body:    draft.body    ?? "",
        };
        if (restored.body.trim()) {
          setForm(restored);
          setHasDraft(true);
          if (restored.cc) setShowCc(true);
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Auto-save body to localStorage on every change
  function handleChange(field: keyof FormState, value: string) {
    const next = { ...form, [field]: value };
    setForm(next);
    setError(null);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
    if (field === "body" && value.trim()) setHasDraft(false);
  }

  async function handleSend() {
    if (!form.to.trim() || !form.subject.trim() || !form.body.trim()) {
      setError("To, Subject, and Body are required.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: form.to, subject: form.subject, body: form.body, ...(replyToId ? { reply_to_id: replyToId } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? `HTTP ${res.status}`);
      }
      localStorage.removeItem(DRAFT_KEY);
      setSentTo(form.to);
      setForm(EMPTY_FORM);
      setReplyToId(null);
      setHasDraft(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to send email.");
    } finally {
      setSending(false);
    }
  }

  function handleComposeAnother() {
    setSentTo(null);
    setError(null);
    setTimeout(() => bodyRef.current?.focus(), 50);
  }

  // ── Sent confirmation view ──────────────────────────────────────────────────
  if (sentTo) {
    return (
      <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div className="sj-panel-header">
          <Mail size={13} style={{ color: "var(--color-icon)" }} />
          <span className="sj-label">Compose Email</span>
        </div>
        <div
          className="sj-panel-body"
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <div
            className="sj-card"
            style={{
              padding: "var(--sp-6)",
              display: "flex", flexDirection: "column", alignItems: "center",
              gap: "var(--sp-4)", maxWidth: 360, width: "100%",
              borderLeft: "3px solid #22c55e",
              textAlign: "center",
            }}
          >
            <CheckCircle2 size={36} style={{ color: "#22c55e" }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>
                Email sent!
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginTop: 4 }}>
                Sent to <strong style={{ color: "var(--color-text)" }}>{sentTo}</strong>
              </div>
            </div>
            <button
              onClick={handleComposeAnother}
              style={{
                background: "var(--color-accent)", color: "#fff",
                border: "none", borderRadius: "var(--r-sm)",
                padding: "6px 16px", fontSize: 12, cursor: "pointer",
                display: "flex", alignItems: "center", gap: "var(--sp-2)",
              }}
            >
              <Mail size={12} /> Compose Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Compose form view ───────────────────────────────────────────────────────
  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Mail size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Compose Email</span>
        {hasDraft && (
          <span style={{
            marginLeft: "var(--sp-3)", fontSize: 10,
            color: "var(--color-text-muted)", fontStyle: "italic",
          }}>
            Draft restored
          </span>
        )}
      </div>

      <div
        className="sj-panel-body"
        style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
      >
        {/* To */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <label style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>To</label>
          <input
            className="sj-input"
            type="email"
            placeholder="recipient@example.com"
            value={form.to}
            onChange={(e) => handleChange("to", e.target.value)}
            style={{ fontSize: 12 }}
          />
        </div>

        {/* CC toggle */}
        <div>
          <button
            onClick={() => setShowCc((v) => !v)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--color-text-muted)", fontSize: 11,
              display: "flex", alignItems: "center", gap: 3, padding: 0,
            }}
          >
            {showCc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            CC (optional)
          </button>
          {showCc && (
            <input
              className="sj-input"
              type="text"
              placeholder="cc@example.com, cc2@example.com"
              value={form.cc}
              onChange={(e) => handleChange("cc", e.target.value)}
              style={{ fontSize: 12, marginTop: "var(--sp-2)" }}
            />
          )}
        </div>

        {/* Subject */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <label style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>Subject</label>
          <input
            className="sj-input"
            type="text"
            placeholder="Subject"
            value={form.subject}
            onChange={(e) => handleChange("subject", e.target.value)}
            style={{ fontSize: 12 }}
          />
        </div>

        {/* Body */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--sp-2)" }}>
            <label style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 500 }}>Body</label>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
              {form.body.length > 0 && (
                <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                  {form.body.length} chars
                </span>
              )}
              {form.body.trim() && (
                <>
                  <select
                    value={tone}
                    onChange={e => setTone(e.target.value as typeof tone)}
                    style={{
                      fontSize: 10, padding: "2px 6px", borderRadius: "var(--r-sm)",
                      background: "var(--color-surface-raised)", border: "var(--border)",
                      color: "var(--color-text-muted)", cursor: "pointer",
                    }}
                  >
                    <option value="professional">Professional</option>
                    <option value="friendly">Friendly</option>
                    <option value="concise">Concise</option>
                  </select>
                  <button
                    onClick={handleImprove}
                    disabled={improving}
                    title="Rewrite with Jazper"
                    style={{
                      display: "flex", alignItems: "center", gap: 3,
                      padding: "3px 8px", borderRadius: "var(--r-sm)",
                      background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)",
                      color: "var(--color-accent)", fontSize: 10, cursor: improving ? "not-allowed" : "pointer",
                      opacity: improving ? 0.6 : 1,
                    }}
                  >
                    {improving ? <Loader2 size={10} className="sj-spin" /> : <Sparkles size={10} />}
                    {improving ? "Improving…" : "Improve"}
                  </button>
                </>
              )}
            </div>
          </div>
          <textarea
            ref={bodyRef}
            className="sj-input"
            placeholder="Write your message…"
            value={form.body}
            onChange={(e) => handleChange("body", e.target.value)}
            rows={8}
            style={{ fontSize: 12, resize: "vertical", minHeight: 160, flex: 1 }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: "var(--sp-2)",
            padding: "var(--sp-3)", borderRadius: "var(--r-sm)",
            background: "#fef2f2", border: "1px solid #fecaca",
            color: "#dc2626", fontSize: 12,
          }}>
            <AlertCircle size={13} style={{ flexShrink: 0 }} />
            {error}
          </div>
        )}

        {/* Send button */}
        <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: "var(--sp-2)" }}>
          <button
            onClick={handleSend}
            disabled={sending}
            style={{
              background: sending ? "var(--color-surface-raised)" : "var(--color-accent)",
              color: sending ? "var(--color-text-muted)" : "#fff",
              border: "none", borderRadius: "var(--r-sm)",
              padding: "8px 20px", fontSize: 12, cursor: sending ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: "var(--sp-2)",
              fontWeight: 500,
            }}
          >
            <Send size={12} />
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
