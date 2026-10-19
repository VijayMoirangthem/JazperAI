"use client";

import { useState, useEffect, useRef } from "react";
import { FileText, Upload, Save, Trash2, RefreshCw, CheckCircle, Download } from "lucide-react";

const API = "http://localhost:8000/api/resume";

interface ResumeData {
  resume_text: string;
  resume_filename: string | null;
  resume_updated_at: string | null;
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

export function ResumePanel() {
  const [data, setData]         = useState<ResumeData | null>(null);
  const [text, setText]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved]       = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(API)
      .then(r => r.json())
      .then((d: ResumeData) => { setData(d); setText(d.resume_text); })
      .catch(() => {});
  }, []);

  async function saveText() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`${API}/text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(await r.text());
      const refreshed: ResumeData = await fetch(API).then(r => r.json());
      setData(refreshed);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(`${API}/upload`, { method: "POST", body: form });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || "Upload failed");
      }
      const refreshed: ResumeData = await fetch(API).then(r => r.json());
      setData(refreshed);
      setText(refreshed.resume_text);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function loadFromQuestionnaire() {
    setLoadingDoc(true);
    setError(null);
    try {
      const r = await fetch("http://localhost:8000/api/profile/load-doc", { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const refreshed: ResumeData = await fetch(API).then(r => r.json());
      setData(refreshed);
      setText(refreshed.resume_text);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load questionnaire");
    } finally {
      setLoadingDoc(false);
    }
  }

  async function deleteResume() {
    if (!confirm("Clear resume? This cannot be undone.")) return;
    await fetch(API, { method: "DELETE" });
    setText("");
    setData({ resume_text: "", resume_filename: null, resume_updated_at: null });
  }

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="sj-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div className="sj-panel-header">
        <FileText size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Resume Manager</span>
        {saved && (
          <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: "auto", fontSize: 11, color: "#22c55e" }}>
            <CheckCircle size={11} /> Saved
          </span>
        )}
      </div>

      <div className="sj-panel-body sj-flex-col sj-gap-3" style={{ flex: 1, overflowY: "auto" }}>

        {/* Metadata bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          {data?.resume_filename && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              📄 {data.resume_filename}
            </span>
          )}
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            Last updated: {relativeTime(data?.resume_updated_at ?? null)}
          </span>
          {charCount > 0 && (
            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars
            </span>
          )}
        </div>

        {/* Upload zone */}
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            border: "2px dashed var(--color-border)",
            borderRadius: 8,
            padding: "14px 20px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 10,
            color: "var(--color-text-muted)",
            fontSize: 12,
            transition: "border-color 0.15s",
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--color-accent)")}
          onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--color-border)")}
        >
          {uploading
            ? <RefreshCw size={14} className="sj-spin" />
            : <Upload size={14} />}
          <span>{uploading ? "Parsing…" : "Upload PDF, TXT, or MD — or paste below"}</span>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.txt,.md"
            style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={{ fontSize: 12, color: "#ef4444", padding: "8px 12px", background: "rgba(239,68,68,0.1)", borderRadius: 6 }}>
            {error}
          </div>
        )}

        {/* Text area */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Paste your resume text here, or upload a file above…"
          style={{
            flex: 1,
            minHeight: 320,
            resize: "vertical",
            background: "var(--color-surface-raised, var(--color-bg))",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            padding: 14,
            fontSize: 12,
            fontFamily: "var(--font-mono, monospace)",
            lineHeight: 1.6,
            color: "var(--color-text, var(--color-fg))",
            outline: "none",
          }}
        />

        {/* Action row */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={saveText}
            disabled={saving || !text.trim()}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 16px", borderRadius: 6, fontSize: 12,
              background: "var(--color-accent)", border: "none",
              cursor: saving || !text.trim() ? "not-allowed" : "pointer",
              color: "#fff", opacity: saving || !text.trim() ? 0.5 : 1,
            }}
          >
            {saving ? <RefreshCw size={11} className="sj-spin" /> : <Save size={11} />}
            Save Resume
          </button>

          {text && (
            <button
              onClick={deleteResume}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 6, fontSize: 12,
                background: "transparent", border: "1px solid var(--color-border)",
                cursor: "pointer", color: "#ef4444",
              }}
            >
              <Trash2 size={11} /> Clear
            </button>
          )}
          <button
            onClick={loadFromQuestionnaire}
            disabled={loadingDoc}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 12px", borderRadius: 6, fontSize: 12,
              background: "transparent", border: "1px solid var(--color-border)",
              cursor: loadingDoc ? "not-allowed" : "pointer",
              color: "var(--color-accent)", opacity: loadingDoc ? 0.6 : 1,
            }}
          >
            {loadingDoc ? <RefreshCw size={11} className="sj-spin" /> : <Download size={11} />}
            Load Questionnaire
          </button>
        </div>

        <p style={{ fontSize: 11, color: "var(--color-text-muted)", opacity: 0.7 }}>
          Your resume is used by Atlas when writing cover letters and by Jazper when answering career questions.
        </p>
      </div>
    </div>
  );
}
