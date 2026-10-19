"use client";

/**
 * COOS Studio — Phase 8D
 *
 * The full 5-zone developer cockpit. Activated by the Studio Mode toggle in the
 * Topbar (or Ctrl+Shift+S). Replaces the normal sidebar+panel layout with:
 *
 *  ┌──────┬──────────────────────┬──────────┐
 *  │ TREE │      EDITOR           │ ACTIVITY │  ← flex-1 row
 *  │      ├──────────────────────┤          │
 *  ├──────┤   DIFF / APPROVAL    ├──────────┤  ← 220px row
 *  │ (in  │                      │ GIT+SYS  │
 *  │ tree │                      │          │
 *  └──────┴──────────────────────┴──────────┘
 *
 * Actually simplified to flex layout:
 *  Top row:    FileTree (220px) | Editor (flex-1) | ActivityFeed (280px)
 *  Bottom row: DiffApprovalZone (flex-1) | GitSystem+Processes (280px)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import "@/lib/monacoLocal";
import DiffEditorComponent from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import {
  Folder, FolderOpen, FileCode, FileText, File,
  ChevronRight, ChevronDown, RefreshCw, Save,
  X, GitBranch, Circle, Activity, CheckCircle, AlertCircle,
  Terminal, Eye, Pencil, GitCommit, GitPullRequest,
  CheckSquare, XSquare, Edit3, Zap, Cpu, HardDrive, MemoryStick,
} from "lucide-react";
import { useApprovals } from "@/hooks/useApprovals";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Shared types ──────────────────────────────────────────────────────────────

interface TreeNode {
  name: string; path: string; type: "file" | "dir";
  children?: TreeNode[]; truncated?: boolean;
}

interface OpenTab {
  path: string; label: string; content: string;
  dirty: boolean; language: string;
}

interface IdeEvent {
  ts: string; agent: string; action: string; file?: string;
  reason?: string; command?: string; ok?: boolean; output?: string;
  old?: string; new?: string; summary?: string;
  confidence?: number; heartbeat?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  py: "python", json: "json", md: "markdown", yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", cfg: "ini", html: "html",
  css: "css", scss: "scss", sql: "sql", sh: "shell", bat: "shell", txt: "plaintext",
};

function detectLanguage(path: string): string {
  return EXT_LANG[path.split(".").pop()?.toLowerCase() ?? ""] ?? "plaintext";
}
function fileLabel(path: string): string { return path.split("/").pop() ?? path; }

const AGENT_COLORS: Record<string, string> = {
  Oracle: "#60a5fa", Forge: "#fbbf24", Commander: "#34d399",
  Aria: "#a78bfa", Voyager: "#f472b6", Darwin: "#f97316",
};

const ACTION_ICONS: Record<string, React.ReactNode> = {
  reading: <Eye size={11}/>, editing: <Pencil size={11}/>, creating: <Pencil size={11}/>,
  running: <Terminal size={11}/>, result: <CheckCircle size={11}/>,
  diagnosed: <CheckCircle size={11}/>, error: <AlertCircle size={11}/>,
  done: <CheckCircle size={11}/>, screenshot: <Eye size={11}/>,
};

// ── FileIcon ──────────────────────────────────────────────────────────────────

function FileIcon({ name, size = 13 }: { name: string; size?: number }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts","tsx","js","jsx","py","sql","sh","bat"].includes(ext))
    return <FileCode size={size} style={{ color: "#60a5fa", flexShrink: 0 }} />;
  if (["json","yaml","yml","toml","ini","cfg"].includes(ext))
    return <FileText size={size} style={{ color: "#a78bfa", flexShrink: 0 }} />;
  return <File size={size} style={{ color: "#64748b", flexShrink: 0 }} />;
}

// ── TreeItem ──────────────────────────────────────────────────────────────────

function TreeItem({ node, depth, onOpenFile, activeFilePath, activeAgentFiles }: {
  node: TreeNode; depth: number;
  onOpenFile: (p: string) => void;
  activeFilePath: string | null;
  activeAgentFiles: Record<string, string>;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isActive  = node.type === "file" && node.path === activeFilePath;
  const agentName = activeAgentFiles[node.path];

  return (
    <div>
      <button
        onClick={() => node.type === "dir" ? setOpen(o => !o) : onOpenFile(node.path)}
        style={{
          display: "flex", alignItems: "center", gap: 4, width: "100%",
          padding: `2px 6px 2px ${8 + depth * 12}px`,
          background: isActive ? "rgba(99,102,241,0.2)" : "transparent",
          border: "none", cursor: "pointer", textAlign: "left", borderRadius: 3,
          color: isActive ? "var(--color-accent)" : "var(--color-text)",
          position: "relative",
        }}
      >
        {node.type === "dir" ? (
          <>
            <span style={{ flexShrink: 0, color: "#94a3b8" }}>
              {open ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
            </span>
            {open
              ? <FolderOpen size={13} style={{ color: "#f59e0b", flexShrink: 0 }}/>
              : <Folder size={13} style={{ color: "#f59e0b", flexShrink: 0 }}/>}
          </>
        ) : (
          <>
            <span style={{ width: 11, flexShrink: 0 }} />
            <FileIcon name={node.name} />
          </>
        )}
        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {node.name}
        </span>
        {agentName && (
          <span style={{
            width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
            background: AGENT_COLORS[agentName] ?? "#f97316",
            boxShadow: `0 0 4px ${AGENT_COLORS[agentName] ?? "#f97316"}`,
          }} title={`${agentName} is working here`} />
        )}
      </button>
      {node.type === "dir" && open && node.children && (
        <div>
          {node.children.map(child => (
            <TreeItem key={child.path} node={child} depth={depth + 1}
              onOpenFile={onOpenFile} activeFilePath={activeFilePath}
              activeAgentFiles={activeAgentFiles} />
          ))}
          {node.truncated && (
            <p style={{ fontSize: 10, color: "#64748b", paddingLeft: 8 + (depth+1)*12 }}>… truncated</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileTree zone ─────────────────────────────────────────────────────────────

function FileTreeZone({ onOpenFile, activeFilePath, activeAgentFiles }: {
  onOpenFile: (p: string) => void;
  activeFilePath: string | null;
  activeAgentFiles: Record<string, string>;
}) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try { const r = await fetch(`${API}/api/ide/tree`); if (r.ok) setTree(await r.json()); }
    catch { /**/ } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch_(); }, [fetch_]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 8px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b" }}>FILES</span>
        <button onClick={fetch_} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 2 }}>
          <RefreshCw size={11} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {loading && !tree ? (
          <p style={{ fontSize: 11, color: "#64748b", padding: "8px 12px" }}>Loading…</p>
        ) : tree ? (
          tree.children?.map(child => (
            <TreeItem key={child.path} node={child} depth={0}
              onOpenFile={onOpenFile} activeFilePath={activeFilePath}
              activeAgentFiles={activeAgentFiles} />
          ))
        ) : (
          <p style={{ fontSize: 11, color: "#64748b", padding: "8px 12px" }}>Could not load</p>
        )}
      </div>
    </div>
  );
}

// ── ActivityFeed zone ─────────────────────────────────────────────────────────

function EventCard({ ev }: { ev: IdeEvent }) {
  const [expanded, setExpanded] = useState(false);
  const color  = AGENT_COLORS[ev.agent] ?? "#94a3b8";
  const age    = Math.floor((Date.now() - new Date(ev.ts).getTime()) / 1000);
  const ageStr = age < 60 ? `${age}s` : `${Math.floor(age/60)}m`;
  const detail = ev.command ?? ev.file ?? ev.summary ?? "";
  const hasExtra = !!(ev.output || ev.old || ev.new || ev.reason);

  return (
    <div
      style={{ padding: "6px 10px", borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: hasExtra ? "pointer" : "default" }}
      onClick={() => hasExtra && setExpanded(e => !e)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 9, color: "#475569", flexShrink: 0 }}>{ageStr}</span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: `${color}22`, color, flexShrink: 0 }}>
          {ev.agent}
        </span>
        <span style={{ color, flexShrink: 0 }}>{ACTION_ICONS[ev.action] ?? <Activity size={11}/>}</span>
        <span style={{ fontSize: 11, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
          {ev.action}{detail ? ` · ${detail}` : ""}
        </span>
        {ev.ok === false && <AlertCircle size={10} style={{ color: "#ef4444", flexShrink: 0 }}/>}
        {ev.ok === true  && <CheckCircle size={10} style={{ color: "#22c55e", flexShrink: 0 }}/>}
      </div>
      {expanded && (
        <div style={{ marginTop: 4, fontSize: 10 }}>
          {ev.reason && <p style={{ color: "#64748b", margin: "2px 0" }}>{ev.reason}</p>}
          {(ev.old || ev.new) && (
            <div style={{ fontFamily: "monospace", background: "rgba(0,0,0,0.3)", padding: "3px 6px", borderRadius: 3, marginTop: 2 }}>
              {ev.old && <div style={{ color: "#f87171" }}>- {ev.old}</div>}
              {ev.new && <div style={{ color: "#4ade80" }}>+ {ev.new}</div>}
            </div>
          )}
          {ev.output && (
            <pre style={{ color: "#94a3b8", fontFamily: "monospace", margin: "3px 0 0",
                          whiteSpace: "pre-wrap", wordBreak: "break-all",
                          background: "rgba(0,0,0,0.2)", padding: "3px 6px",
                          borderRadius: 3, maxHeight: 100, overflowY: "auto" }}>
              {ev.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function ActivityFeedZone({ events, connected }: { events: IdeEvent[]; connected: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 10px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b" }}>ACTIVITY</span>
        <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 8,
          background: connected ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
          color: connected ? "#22c55e" : "#64748b" }}>
          {connected ? "● live" : "○ off"}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {events.length === 0 ? (
          <p style={{ fontSize: 11, color: "#475569", padding: "10px 12px" }}>Waiting for agent activity…</p>
        ) : events.map((ev, i) => <EventCard key={i} ev={ev} />)}
      </div>
    </div>
  );
}

// ── Diff / Approval zone ──────────────────────────────────────────────────────

function DiffApprovalZone() {
  const { pending, approve, deny } = useApprovals();
  const [gitDiff, setGitDiff]   = useState<string>("");
  const [editMode, setEditMode] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyMsg, setApplyMsg]   = useState<string | null>(null);
  const [busy, setBusy]           = useState<string | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);

  const first = pending[0] ?? null;
  const file   = (first?.payload?.file    as string) ?? "";
  const oldStr = (first?.payload?.old_string as string) ?? "";
  const newStr = (first?.payload?.new_string as string) ?? "";
  const hasDiff = !!(first && (oldStr || newStr));

  // Fetch git diff when no pending approval
  useEffect(() => {
    if (!first) {
      fetch(`${API}/api/ide/git/diff`).then(r => r.text()).then(setGitDiff).catch(() => setGitDiff(""));
    }
  }, [first]);

  async function handleApprove() {
    if (!first) return;
    setBusy(first.id);
    await approve(first.id);
    setBusy(null);
    setEditMode(false);
  }

  async function handleDeny() {
    if (!first) return;
    setBusy(first.id);
    await deny(first.id);
    setBusy(null);
    setEditMode(false);
  }

  async function handleApplyMine() {
    if (!editorRef.current || !file) return;
    const userNew = editorRef.current.getModifiedEditor().getValue();
    setApplyBusy(true);
    setApplyMsg(null);
    try {
      const r = await fetch(`${API}/api/ide/apply-patch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file, old_string: oldStr, new_string: userNew }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setApplyMsg(`Failed: ${d.detail ?? r.statusText}`); return; }
      setApplyMsg("Applied — denying Darwin's version…");
      await new Promise(res => setTimeout(res, 500));
      await deny(first!.id);
      setEditMode(false); setApplyMsg(null);
    } catch (e: unknown) {
      setApplyMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setApplyBusy(false);
    }
  }

  const isBusy = busy === first?.id;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "5px 10px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b", flex: 1 }}>
          {first ? (
            <span style={{ color: "#f97316" }}>⚠ APPROVAL PENDING — {first.agent}</span>
          ) : "DIFF / WORKSPACE"}
        </span>

        {first && hasDiff && (
          <button
            onClick={() => { setEditMode(e => !e); setApplyMsg(null); }}
            style={{
              display: "flex", alignItems: "center", gap: 3, fontSize: 10,
              background: editMode ? "rgba(251,191,36,0.12)" : "var(--color-surface)",
              border: `1px solid ${editMode ? "rgba(251,191,36,0.3)" : "var(--color-border)"}`,
              color: editMode ? "#fbbf24" : "var(--color-text)",
              borderRadius: 4, padding: "2px 7px", cursor: "pointer",
            }}
          >
            <Edit3 size={9}/> {editMode ? "Editing" : "Edit"}
          </button>
        )}

        {first && (
          <div style={{ display: "flex", gap: 5 }}>
            <button
              onClick={handleApprove} disabled={isBusy}
              style={{
                display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700,
                background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)",
                color: "#4ade80", borderRadius: 4, padding: "3px 10px",
                cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.5 : 1,
              }}
            >
              <CheckSquare size={11}/> Approve
            </button>
            <button
              onClick={handleDeny} disabled={isBusy}
              style={{
                display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 700,
                background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.25)",
                color: "#f87171", borderRadius: 4, padding: "3px 10px",
                cursor: isBusy ? "not-allowed" : "pointer", opacity: isBusy ? 0.5 : 1,
              }}
            >
              <XSquare size={11}/> Deny
            </button>
          </div>
        )}
      </div>

      {/* Diff editor */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {hasDiff ? (
          <DiffEditorComponent
            height="100%"
            language={file ? detectLanguage(file) : "plaintext"}
            original={oldStr}
            modified={newStr}
            theme="vs-dark"
            options={{
              readOnly: !editMode,
              // @ts-expect-error — renderSideBySide is a valid DiffEditor option not in the base type
              renderSideBySide: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 11,
              lineNumbers: "off",
              folding: false,
              wordWrap: "on",
              renderOverviewRuler: false,
            }}
            onMount={ed => { (editorRef as { current: unknown }).current = ed; }}
          />
        ) : gitDiff ? (
          <DiffEditorComponent
            height="100%"
            language="plaintext"
            original=""
            modified={gitDiff}
            theme="vs-dark"
            options={{
              readOnly: true,
              // @ts-expect-error — renderSideBySide is a valid DiffEditor option not in the base type
              renderSideBySide: false,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 11,
              lineNumbers: "off",
              folding: false,
              wordWrap: "on",
            }}
            onMount={ed => { (editorRef as { current: unknown }).current = ed; }}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                        height: "100%", flexDirection: "column", gap: 6, opacity: 0.3 }}>
            <GitBranch size={24} />
            <p style={{ fontSize: 11, margin: 0 }}>Clean working tree</p>
          </div>
        )}
      </div>

      {/* Apply Mine strip */}
      {editMode && first && (
        <div style={{ padding: "6px 10px", borderTop: "1px solid var(--color-border)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <button
            onClick={handleApplyMine} disabled={applyBusy || isBusy}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)",
              color: "#fbbf24", borderRadius: 5, padding: "5px 0", fontSize: 11,
              fontWeight: 700, cursor: applyBusy || isBusy ? "not-allowed" : "pointer",
              opacity: applyBusy || isBusy ? 0.5 : 1, width: "100%",
            }}
          >
            <Zap size={12}/> {applyBusy ? "Applying…" : "Apply Mine — write my edit, deny Darwin's version"}
          </button>
          {applyMsg && <div style={{ fontSize: 10, opacity: 0.7 }}>{applyMsg}</div>}
        </div>
      )}
    </div>
  );
}

// ── Git + Process zone ────────────────────────────────────────────────────────

interface ProcessInfo {
  name: string; status: string; pid?: number;
  cpu_pct?: number; mem_mb?: number;
}

function GitProcessZone() {
  const [status,  setStatus]    = useState("");
  const [log,     setLog]       = useState("");
  const [message, setMessage]   = useState("");
  const [busy,    setBusy]      = useState(false);
  const [result,  setResult]    = useState<{ ok: boolean; output: string } | null>(null);
  const [procs,   setProcs]     = useState<ProcessInfo[]>([]);

  const refresh = useCallback(async () => {
    const [sr, lr, pr] = await Promise.all([
      fetch(`${API}/api/ide/git/status`).then(r => r.text()).catch(() => ""),
      fetch(`${API}/api/ide/git/log?n=6`).then(r => r.text()).catch(() => ""),
      fetch(`${API}/api/control-tower/processes`).then(r => r.json()).catch(() => ({ processes: [] })),
    ]);
    setStatus(sr.trim());
    setLog(lr.trim());
    setProcs(pr.processes ?? []);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function handleCommit() {
    if (!message.trim()) return;
    setBusy(true); setResult(null);
    try {
      const r = await fetch(`${API}/api/ide/git/commit`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const d = await r.json();
      setResult({ ok: d.ok, output: d.output ?? d.message ?? "" });
      if (d.ok) { setMessage(""); refresh(); }
    } catch (e: unknown) { setResult({ ok: false, output: String(e) }); }
    finally { setBusy(false); }
  }

  const changedCount = status.split("\n").filter(Boolean).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "5px 10px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b", display: "flex", alignItems: "center", gap: 5 }}>
          <GitBranch size={10}/> GIT + SYSTEM
        </span>
        <button onClick={refresh} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 2 }}>
          <RefreshCw size={10}/>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 10 }}>

        {/* Process health */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>
            PROCESSES
          </div>
          {procs.length === 0 ? (
            <p style={{ fontSize: 10, color: "#475569", margin: 0 }}>Loading…</p>
          ) : procs.map(p => {
            const alive = p.status === "running";
            const dotColor = alive ? "#22c55e" : "#ef4444";
            return (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0 }}/>
                <span style={{ fontSize: 10, flex: 1, color: alive ? "var(--color-text)" : "#ef4444" }}>{p.name}</span>
                {p.cpu_pct !== undefined && (
                  <span style={{ fontSize: 9, color: "#475569", display: "flex", alignItems: "center", gap: 2 }}>
                    <Cpu size={8}/> {p.cpu_pct.toFixed(0)}%
                  </span>
                )}
                {p.mem_mb !== undefined && (
                  <span style={{ fontSize: 9, color: "#475569", display: "flex", alignItems: "center", gap: 2 }}>
                    <MemoryStick size={8}/> {p.mem_mb}M
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Git status */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4,
                        display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span>STATUS</span>
            {changedCount > 0 && (
              <span style={{ fontSize: 9, background: "rgba(245,158,11,0.15)", color: "#f59e0b", borderRadius: 8, padding: "0 5px", fontWeight: 700 }}>
                {changedCount} changed
              </span>
            )}
          </div>
          {status ? (
            <pre style={{ fontSize: 9, margin: 0, fontFamily: "monospace", color: "#f59e0b",
                          background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "4px 6px",
                          maxHeight: 70, overflowY: "auto" }}>
              {status}
            </pre>
          ) : <p style={{ fontSize: 10, color: "#22c55e", margin: 0 }}>✓ Clean</p>}
        </div>

        {/* Commit */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Commit message…"
            rows={2}
            style={{
              width: "100%", resize: "none", fontSize: 11,
              background: "var(--color-bg)", border: "1px solid var(--color-border)",
              borderRadius: 4, padding: "4px 6px", color: "var(--color-text)",
              fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
          <button
            onClick={handleCommit}
            disabled={busy || !message.trim()}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
              color: "#818cf8", borderRadius: 5, padding: "4px 0", fontSize: 10,
              fontWeight: 700, cursor: busy || !message.trim() ? "not-allowed" : "pointer",
              opacity: busy || !message.trim() ? 0.5 : 1, width: "100%",
            }}
          >
            <GitCommit size={11}/> {busy ? "Committing…" : "Stage All & Commit"}
          </button>
          {result && (
            <pre style={{ fontSize: 9, margin: 0, fontFamily: "monospace",
                          color: result.ok ? "#22c55e" : "#f87171",
                          background: "rgba(0,0,0,0.2)", borderRadius: 4, padding: "3px 5px",
                          whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 60, overflowY: "auto" }}>
              {result.output}
            </pre>
          )}
        </div>

        {/* Recent commits */}
        {log && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4, display: "flex", alignItems: "center", gap: 4 }}>
              <GitPullRequest size={9}/> RECENT
            </div>
            <pre style={{ fontSize: 9, margin: 0, fontFamily: "monospace", color: "#64748b",
                          background: "rgba(0,0,0,0.15)", borderRadius: 4, padding: "4px 6px",
                          whiteSpace: "pre-wrap", wordBreak: "break-all", maxHeight: 80, overflowY: "auto" }}>
              {log}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main StudioLayout ─────────────────────────────────────────────────────────

export function StudioLayout() {
  const [tabs,      setTabs]      = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [saving,    setSaving]    = useState(false);
  const [events,    setEvents]    = useState<IdeEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [activeAgentFiles, setActiveAgentFiles] = useState<Record<string, string>>({});
  const editorRef = useRef<unknown>(null);

  const activeTabData = tabs.find(t => t.path === activeTab) ?? null;

  // SSE for agent events
  useEffect(() => {
    const es = new EventSource(`${API}/api/ide/events`);
    es.onopen    = () => setConnected(true);
    es.onerror   = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const ev: IdeEvent = JSON.parse(e.data);
        if (ev.heartbeat) return;
        setEvents(prev => [ev, ...prev].slice(0, 200));
        // Track active agent files
        if (ev.file && ev.action !== "done" && ev.action !== "error") {
          setActiveAgentFiles(prev => ({ ...prev, [ev.file!]: ev.agent }));
        } else if (ev.file && (ev.action === "done" || ev.action === "error")) {
          setActiveAgentFiles(prev => {
            const next = { ...prev };
            if (next[ev.file!] === ev.agent) delete next[ev.file!];
            return next;
          });
        }
      } catch { /**/ }
    };
    return () => es.close();
  }, []);

  // Open file
  const openFile = useCallback(async (path: string) => {
    const existing = tabs.find(t => t.path === path);
    if (existing) { setActiveTab(path); return; }
    try {
      const res = await fetch(`${API}/api/ide/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) { alert(`Cannot open: ${(await res.json()).detail}`); return; }
      const { content } = await res.json();
      const tab: OpenTab = { path, label: fileLabel(path), content, dirty: false, language: detectLanguage(path) };
      setTabs(prev => [...prev, tab]);
      setActiveTab(path);
    } catch (e) { alert(`Failed: ${e}`); }
  }, [tabs]);

  const closeTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setTabs(prev => {
      const next = prev.filter(t => t.path !== path);
      if (activeTab === path) {
        const idx = prev.findIndex(t => t.path === path);
        setActiveTab(next[Math.max(0, idx-1)]?.path ?? null);
      }
      return next;
    });
  }, [activeTab]);

  const handleChange = useCallback((value: string | undefined) => {
    if (!activeTab) return;
    setTabs(prev => prev.map(t => t.path === activeTab ? { ...t, content: value ?? "", dirty: true } : t));
  }, [activeTab]);

  const saveActive = useCallback(async () => {
    if (!activeTabData?.dirty) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/ide/file?path=${encodeURIComponent(activeTabData.path)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: activeTabData.content }),
      });
      if (res.ok) setTabs(prev => prev.map(t => t.path === activeTabData.path ? { ...t, dirty: false } : t));
      else alert(`Save failed: ${(await res.json()).detail}`);
    } catch (e) { alert(`Save failed: ${e}`); }
    finally { setSaving(false); }
  }, [activeTabData]);

  // Ctrl+S
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveActive(); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActive]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--color-bg)" }}>

      {/* ── TOP ROW ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>

        {/* File Tree */}
        <div style={{ width: 220, flexShrink: 0, borderRight: "1px solid var(--color-border)", overflow: "hidden", background: "var(--color-surface)" }}>
          <FileTreeZone onOpenFile={openFile} activeFilePath={activeTab} activeAgentFiles={activeAgentFiles} />
        </div>

        {/* Editor */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Tab bar */}
          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", overflowX: "auto", flexShrink: 0, minHeight: 36 }}>
            {tabs.length === 0 && <span style={{ fontSize: 11, color: "#64748b", padding: "0 12px" }}>Select a file from the tree</span>}
            {tabs.map(tab => (
              <button
                key={tab.path}
                onClick={() => setActiveTab(tab.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "0 10px", height: 36,
                  background: activeTab === tab.path ? "var(--color-bg)" : "transparent",
                  border: "none", borderRight: "1px solid var(--color-border)",
                  borderBottom: activeTab === tab.path ? "2px solid var(--color-accent)" : "2px solid transparent",
                  cursor: "pointer", color: "var(--color-text)", fontSize: 12, whiteSpace: "nowrap",
                }}
              >
                <FileIcon name={tab.label} size={12} />
                {tab.label}
                {tab.dirty && <Circle size={6} style={{ color: "#f59e0b", fill: "#f59e0b", flexShrink: 0 }}/>}
                {/* Agent indicator */}
                {activeAgentFiles[tab.path] && (
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: AGENT_COLORS[activeAgentFiles[tab.path]] ?? "#f97316", flexShrink: 0 }}/>
                )}
                <span onClick={e => closeTab(tab.path, e)} style={{ marginLeft: 2, cursor: "pointer", color: "#64748b", display: "flex", alignItems: "center" }}>
                  <X size={11}/>
                </span>
              </button>
            ))}
            {activeTabData?.dirty && (
              <button onClick={saveActive} disabled={saving}
                style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, padding: "0 10px", height: 36, background: "none", border: "none", cursor: "pointer", color: "#22c55e", fontSize: 12, flexShrink: 0 }}>
                <Save size={13}/> {saving ? "Saving…" : "Save"}
              </button>
            )}
          </div>

          {/* Monaco */}
          <div style={{ flex: 1, overflow: "hidden" }}>
            {activeTabData ? (
              <Editor
                key={activeTabData.path}
                height="100%"
                language={activeTabData.language}
                value={activeTabData.content}
                theme="vs-dark"
                onChange={handleChange}
                onMount={ed => { editorRef.current = ed; }}
                options={{
                  fontSize: 13,
                  fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace",
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  lineNumbers: "on",
                  renderLineHighlight: "line",
                  smoothScrolling: true,
                  cursorBlinking: "smooth",
                  padding: { top: 8 },
                }}
              />
            ) : (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8 }}>
                <FileCode size={40} style={{ color: "#334155", opacity: 0.5 }}/>
                <p style={{ color: "#475569", fontSize: 13 }}>COOS Studio</p>
                <p style={{ color: "#334155", fontSize: 11, opacity: 0.6 }}>Open a file · Ctrl+S to save · Agent activity streams live</p>
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--color-border)", overflow: "hidden", background: "var(--color-surface)" }}>
          <ActivityFeedZone events={events} connected={connected} />
        </div>
      </div>

      {/* ── BOTTOM ROW ── */}
      <div style={{ height: 220, flexShrink: 0, display: "flex", borderTop: "1px solid var(--color-border)" }}>
        {/* Diff / Approval */}
        <div style={{ flex: 1, borderRight: "1px solid var(--color-border)", overflow: "hidden", background: "var(--color-bg)" }}>
          <DiffApprovalZone />
        </div>
        {/* Git + System */}
        <div style={{ width: 280, flexShrink: 0, overflow: "hidden", background: "var(--color-surface)" }}>
          <GitProcessZone />
        </div>
      </div>
    </div>
  );
}
