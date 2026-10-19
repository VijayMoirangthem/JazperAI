"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  CheckCircle, XCircle, Clock, RefreshCw, Shield,
  AlertTriangle, ChevronDown, ChevronRight, FileCode, History,
  Edit3, Zap,
} from "lucide-react";
import DiffEditor from "@monaco-editor/react";
import "@/lib/monacoLocal";
import type { editor as MonacoEditor } from "monaco-editor";
import { useApprovals, type ApprovalRequest } from "@/hooks/useApprovals";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryItem {
  id:          string;
  agent:       string;
  action_type: string;
  description: string;
  status:      string;
  created_at:  string | null;
  resolved_at: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  apply_code_fix:       "Code Repair",
  create_feature_files: "New Feature",
  restart_service:      "Service Restart",
  delete_file:          "File Deletion",
};

const ACTION_COLORS: Record<string, string> = {
  apply_code_fix:       "#f97316",
  create_feature_files: "#3b82f6",
  restart_service:      "#f59e0b",
  delete_file:          "#ef4444",
};

const STATUS_META: Record<string, { color: string; bg: string; label: string }> = {
  pending:       { color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  label: "Pending"       },
  approved:      { color: "#22c55e", bg: "rgba(34,197,94,0.1)",   label: "Approved"      },
  denied:        { color: "#ef4444", bg: "rgba(239,68,68,0.1)",   label: "Denied"        },
  auto_approved: { color: "#94a3b8", bg: "rgba(148,163,184,0.1)", label: "Auto-approved" },
  timed_out:     { color: "#6b7280", bg: "rgba(107,114,128,0.1)", label: "Timed out"     },
};

function fmtAge(iso: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)    return `${s}s ago`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function guessLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", md: "markdown", json: "json", yml: "yaml", yaml: "yaml",
    css: "css", html: "html", sh: "shell", bat: "bat", sql: "sql",
  };
  return map[ext] ?? "plaintext";
}

// ── Monaco Diff block (Phase 8C) ──────────────────────────────────────────────

interface DiffBlockProps {
  file:      string;
  oldStr:    string;
  newStr:    string;
  editMode:  boolean;
  editorRef: React.MutableRefObject<MonacoEditor.IStandaloneDiffEditor | null>;
}

function MonacoDiffBlock({ file, oldStr, newStr, editMode, editorRef }: DiffBlockProps) {
  const lang      = guessLang(file);
  const lineCount = Math.max(oldStr.split("\n").length, newStr.split("\n").length);
  const height    = Math.min(Math.max(lineCount * 19 + 24, 80), 380);

  return (
    <div style={{ borderRadius: 6, overflow: "hidden", border: "1px solid var(--color-border)" }}>
      <DiffEditor
        height={height}
        language={lang}
        original={oldStr}
        modified={newStr}
        theme="vs-dark"
        options={{
          readOnly:              !editMode,
          // @ts-expect-error — renderSideBySide is a valid DiffEditor option not in the base type
          renderSideBySide:     true,
          minimap:              { enabled: false },
          scrollBeyondLastLine: false,
          fontSize:             11,
          lineNumbers:          "off",
          folding:              false,
          wordWrap:             "on",
          renderOverviewRuler:  false,
          scrollbar:            { vertical: "auto", horizontal: "auto" },
          diffWordWrap:         "on",
        }}
        onMount={(ed) => { (editorRef as { current: unknown }).current = ed; }}
      />
    </div>
  );
}

// ── Pending approval card ─────────────────────────────────────────────────────

function PendingCard({
  req, onApprove, onDeny, busy,
}: {
  req:       ApprovalRequest;
  onApprove: (id: string) => void;
  onDeny:    (id: string) => void;
  busy:      boolean;
}) {
  const [open,        setOpen]        = useState(true);
  const [editMode,    setEditMode]    = useState(false);
  const [applyBusy,   setApplyBusy]   = useState(false);
  const [applyMsg,    setApplyMsg]    = useState<string | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);

  const color  = ACTION_COLORS[req.action_type] ?? "#94a3b8";
  const label  = ACTION_LABELS[req.action_type] ?? req.action_type;

  const file   = (req.payload.file   as string)       ?? "";
  const oldStr = (req.payload.old_string as string)   ?? "";
  const newStr = (req.payload.new_string as string)   ?? "";
  const files  = (req.payload.files  as string[])     ?? [];
  const diag   = (req.payload.diagnosis as string)    ?? "";
  const conf   = req.payload.confidence as number | undefined;

  const hasDiff = !!(file && (oldStr || newStr));

  async function handleApplyMine() {
    if (!editorRef.current || !file) return;
    const userNew = editorRef.current.getModifiedEditor().getValue();
    setApplyBusy(true);
    setApplyMsg(null);
    try {
      const r = await fetch(`${API}/api/ide/apply-patch`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ file, old_string: oldStr, new_string: userNew }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setApplyMsg(`Failed: ${d.detail ?? r.statusText}`);
        return;
      }
      setApplyMsg("Applied. Denying Darwin's version...");
      // Deny the original approval — we took care of it ourselves
      await new Promise(res => setTimeout(res, 600));
      onDeny(req.id);
    } catch (e: unknown) {
      setApplyMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <div style={{
      background:   "var(--color-surface)",
      border:       `1px solid var(--color-border)`,
      borderLeft:   `4px solid ${color}`,
      borderRadius: 8,
      marginBottom: 10,
      boxShadow:    "0 2px 12px rgba(0,0,0,0.15)",
    }}>
      {/* Header row */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "12px 14px", background: "none", border: "none",
          cursor: "pointer", color: "var(--color-text)", textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}

        <span style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase",
          background: `color-mix(in srgb, ${color} 12%, transparent)`,
          color, border: `1px solid color-mix(in srgb, ${color} 25%, transparent)`,
          padding: "2px 7px", borderRadius: 3, flexShrink: 0,
        }}>
          {label}
        </span>

        <span style={{ fontSize: 11, fontWeight: 700, color, flexShrink: 0 }}>
          {req.agent}
        </span>

        <span style={{
          fontSize: 11, flex: 1, minWidth: 0,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          opacity: 0.75,
        }}>
          {req.description}
        </span>

        <span style={{ fontSize: 10, opacity: 0.4, flexShrink: 0 }}>
          {fmtAge(req.created_at)}
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Oracle diagnosis */}
          {diag && (
            <div style={{
              background: "var(--color-bg)", border: "1px solid var(--color-border)",
              borderRadius: 6, padding: "8px 11px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", marginBottom: 4 }}>
                Oracle diagnosis
              </div>
              <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, opacity: 0.85 }}>{diag}</p>
              {conf !== undefined && (
                <div style={{ marginTop: 5, fontSize: 10, opacity: 0.5 }}>
                  Confidence:{" "}
                  <span style={{
                    color: conf >= 0.8 ? "#22c55e" : conf >= 0.6 ? "#f59e0b" : "#ef4444",
                    fontWeight: 700,
                  }}>
                    {Math.round(conf * 100)}%
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Monaco diff viewer / editor (Phase 8C) */}
          {hasDiff && (
            <div>
              {/* Diff header bar */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                marginBottom: 6, fontSize: 10,
              }}>
                <FileCode size={11} style={{ opacity: 0.5 }} />
                <span style={{ opacity: 0.6, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {file}
                </span>
                <button
                  onClick={() => { setEditMode(e => !e); setApplyMsg(null); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    background: editMode ? "rgba(251,191,36,0.12)" : "var(--color-surface)",
                    border: `1px solid ${editMode ? "rgba(251,191,36,0.3)" : "var(--color-border)"}`,
                    borderRadius: 4, padding: "3px 8px", cursor: "pointer",
                    color: editMode ? "#fbbf24" : "var(--color-text)",
                    fontSize: 10, fontWeight: editMode ? 700 : 400,
                  }}
                >
                  <Edit3 size={10} />
                  {editMode ? "Editing" : "Edit"}
                </button>
              </div>

              <MonacoDiffBlock
                file={file}
                oldStr={oldStr}
                newStr={newStr}
                editMode={editMode}
                editorRef={editorRef}
              />

              {/* Apply Mine button — only in edit mode */}
              {editMode && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    onClick={handleApplyMine}
                    disabled={applyBusy || busy}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)",
                      color: "#fbbf24", borderRadius: 6, padding: "7px 0",
                      fontSize: 12, fontWeight: 700,
                      cursor: applyBusy || busy ? "not-allowed" : "pointer",
                      opacity: applyBusy || busy ? 0.5 : 1, width: "100%",
                    }}
                  >
                    <Zap size={13} />
                    {applyBusy ? "Applying..." : "Apply Mine — write my edit, deny Darwin's version"}
                  </button>
                  {applyMsg && (
                    <div style={{ fontSize: 10, opacity: 0.7, padding: "2px 4px" }}>{applyMsg}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* New files list (create workflow) */}
          {files.length > 0 && (
            <div>
              <div style={{
                fontSize: 10, fontWeight: 700, opacity: 0.5,
                textTransform: "uppercase", marginBottom: 6,
              }}>
                Files to create ({files.length})
              </div>
              {files.map((f, i) => (
                <div key={i} style={{ fontSize: 11, padding: "2px 0", opacity: 0.8 }}>📄 {f}</div>
              ))}
            </div>
          )}

          {/* Approve / Deny */}
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={() => onApprove(req.id)}
              disabled={busy}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
                color: "#4ade80", borderRadius: 6, padding: "8px 0",
                fontSize: 12, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1, transition: "all 0.15s",
              }}
            >
              <CheckCircle size={14} /> Approve
            </button>
            <button
              onClick={() => onDeny(req.id)}
              disabled={busy}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)",
                color: "#f87171", borderRadius: 6, padding: "8px 0",
                fontSize: 12, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer",
                opacity: busy ? 0.5 : 1, transition: "all 0.15s",
              }}
            >
              <XCircle size={14} /> Deny
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History row ───────────────────────────────────────────────────────────────

function HistoryRow({ item }: { item: HistoryItem }) {
  const meta  = STATUS_META[item.status] ?? STATUS_META["timed_out"];
  const color = ACTION_COLORS[item.action_type] ?? "#94a3b8";
  const label = ACTION_LABELS[item.action_type] ?? item.action_type;
  return (
    <div style={{
      padding: "9px 12px",
      background: "var(--color-surface)",
      border: "1px solid var(--color-border)",
      borderRadius: 6, marginBottom: 6,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <span style={{
        fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        color, border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
        padding: "2px 6px", borderRadius: 3, flexShrink: 0,
      }}>
        {label}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.description}
        </div>
        <div style={{ fontSize: 10, opacity: 0.4, marginTop: 2 }}>
          {item.agent} · {fmtAge(item.created_at)}
          {item.resolved_at && ` → resolved ${fmtAge(item.resolved_at)}`}
        </div>
      </div>
      <span style={{
        fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
        background: meta.bg, color: meta.color, flexShrink: 0, textTransform: "uppercase",
      }}>
        {meta.label}
      </span>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ApprovalsPanel({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const { pending, approve, deny } = useApprovals();
  const [tab,     setTab]     = useState<"pending" | "history">("pending");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy,    setBusy]    = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/approvals/history?limit=50`);
      const d = await r.json();
      setHistory(d.history ?? []);
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  async function handleApprove(id: string) {
    setBusy(id);
    await approve(id);
    setBusy(null);
    if (tab === "history") loadHistory();
  }

  async function handleDeny(id: string) {
    setBusy(id);
    await deny(id);
    setBusy(null);
    if (tab === "history") loadHistory();
  }

  const pendingCount = pending.length;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <Shield size={16} style={{ color: "#f97316", flexShrink: 0 }} />
        <h2 className="sj-heading" style={{ margin: 0, flex: 1 }}>Approvals</h2>

        <div style={{ display: "flex", gap: 4 }}>
          {(["pending", "history"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background:  tab === t ? "var(--color-accent)" : "var(--color-surface)",
              color:       tab === t ? "#000" : "var(--color-text)",
              border:      "1px solid var(--color-border)", borderRadius: 5,
              padding:     "4px 12px", fontSize: 11, cursor: "pointer",
              fontWeight:  tab === t ? 700 : 400, textTransform: "capitalize",
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {t === "pending" && pendingCount > 0 && (
                <span style={{
                  background: "#f97316", color: "#fff", borderRadius: 99,
                  fontSize: 9, fontWeight: 700, padding: "0 5px", minWidth: 14,
                  textAlign: "center",
                }}>
                  {pendingCount}
                </span>
              )}
              {t === "pending" ? <><Clock size={11}/> Pending</> : <><History size={11}/> History</>}
            </button>
          ))}
        </div>

        {tab === "history" && (
          <button
            onClick={loadHistory}
            style={{
              background: "none", border: "1px solid var(--color-border)",
              borderRadius: 5, padding: "4px 8px", cursor: "pointer",
              color: "var(--color-text)",
            }}
          >
            <RefreshCw size={13} />
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>

        {tab === "pending" && (
          <>
            {pendingCount === 0 ? (
              <div style={{ textAlign: "center", marginTop: 60, opacity: 0.35 }}>
                <CheckCircle size={32} style={{ margin: "0 auto 12px", display: "block", opacity: 0.5 }} />
                <p style={{ fontSize: 13, margin: 0, fontWeight: 600 }}>All clear</p>
                <p style={{ fontSize: 11, marginTop: 6, opacity: 0.7 }}>
                  No approvals waiting. Darwin will ask here before applying any code changes.
                </p>
                <button
                  onClick={() => onNavigate?.("it_dept")}
                  style={{
                    marginTop: 14, background: "var(--color-surface)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6, padding: "6px 16px", fontSize: 11,
                    cursor: "pointer", color: "var(--color-text)",
                  }}
                >
                  View IT Department →
                </button>
              </div>
            ) : (
              <>
                <div style={{
                  background: "rgba(249,115,22,0.06)", border: "1px solid rgba(249,115,22,0.2)",
                  borderRadius: 7, padding: "8px 12px", marginBottom: 14,
                  fontSize: 11, color: "#fb923c",
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <AlertTriangle size={13} />
                  {pendingCount} action{pendingCount !== 1 ? "s" : ""} waiting for your review.
                  Darwin is paused until you respond.
                </div>
                {pending.map(req => (
                  <PendingCard
                    key={req.id}
                    req={req}
                    onApprove={handleApprove}
                    onDeny={handleDeny}
                    busy={busy === req.id}
                  />
                ))}
              </>
            )}
          </>
        )}

        {tab === "history" && (
          <>
            {loading ? (
              <div style={{ textAlign: "center", padding: 40, opacity: 0.4, fontSize: 12 }}>Loading...</div>
            ) : history.length === 0 ? (
              <div style={{ textAlign: "center", padding: 40, opacity: 0.4, fontSize: 12 }}>No history yet.</div>
            ) : (
              history.map(item => <HistoryRow key={item.id} item={item} />)
            )}
          </>
        )}
      </div>
    </div>
  );
}
