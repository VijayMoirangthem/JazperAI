"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Editor from "@monaco-editor/react";
import "@/lib/monacoLocal";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  Folder, FolderOpen, FileCode, FileText, File,
  ChevronRight, ChevronDown, RefreshCw, Save,
  X, GitBranch, Circle, Activity, CheckCircle, AlertCircle,
  Terminal, Eye, Pencil, GitCommit, GitPullRequest,
  Play, Square, Bot, Sparkles, MessageSquare, Code2,
  Bug, Cpu, Layers, ShieldCheck, Search, SendHorizontal, ChevronUp,
  Settings as SettingsIcon, Type, Palette, Clock,
  PanelLeftClose, PanelRightClose,
} from "lucide-react";
import { useIdeSettings, IDE_FONT_PRESETS, IDE_THEME_PRESETS, type IdeSettings } from "@/hooks/useIdeSettings";
import { toast, confirmDialog, promptDialog, subscribeDialog, type Toast, type DialogRequest } from "@/lib/ideUi";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Real backend health — polls every 5s, not a hardcoded "it's fine" badge. */
function useBackendHealth() {
  const [up, setUp] = useState(true); // optimistic on first paint, corrected within 5s
  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        const r = await fetch(`${API}/api/ide/tree`, { signal: ctrl.signal });
        clearTimeout(t);
        if (!cancelled) setUp(r.ok);
      } catch {
        if (!cancelled) setUp(false);
      }
    }
    check();
    const interval = setInterval(check, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);
  return up;
}

// ── Toast host ─────────────────────────────────────────────────────────────────

const TOAST_COLORS: Record<Toast["kind"], string> = { success: "#22c55e", error: "#f87171", info: "#818cf8" };

function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => toast.subscribe(setItems), []);
  if (items.length === 0) return null;
  return (
    <div style={{ position: "fixed", top: 46, right: 16, zIndex: 8000, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
      {items.map(t => (
        <div key={t.id} style={{
          background: "var(--color-surface-float)", border: `1px solid ${TOAST_COLORS[t.kind]}55`,
          borderLeft: `3px solid ${TOAST_COLORS[t.kind]}`, color: "var(--color-text-primary)",
          borderRadius: 5, padding: "8px 12px", fontSize: 12, boxShadow: "0 6px 20px rgba(0,0,0,0.35)",
          maxWidth: 320, pointerEvents: "all",
        }}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Dialog host (replaces window.confirm / window.prompt) ─────────────────────

function DialogHost() {
  const [req, setReq] = useState<DialogRequest | null>(null);
  const [draft, setDraft] = useState("");
  useEffect(() => subscribeDialog(d => { setReq(d); if (d?.type === "prompt") setDraft(d.defaultValue); }), []);
  if (!req) return null;

  return (
    <div onClick={() => req.type === "confirm" ? req.resolve(false) : req.resolve(null)}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9500, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 360, background: "var(--color-surface)", border: "1px solid var(--color-border-hi)",
        borderRadius: 8, padding: 16, boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
      }}>
        <p style={{ fontSize: 13, color: "var(--color-text-primary)", margin: "0 0 12px" }}>{req.message}</p>
        {req.type === "prompt" && (
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") req.resolve(draft); if (e.key === "Escape") req.resolve(null); }}
            style={{
              width: "100%", boxSizing: "border-box", padding: "6px 8px", marginBottom: 12,
              background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
              borderRadius: 4, color: "var(--color-text-primary)", fontSize: 12,
            }}
          />
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={() => req.type === "confirm" ? req.resolve(false) : req.resolve(null)}
            style={{ padding: "6px 12px", borderRadius: 5, border: "1px solid var(--color-border)", background: "none", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            onClick={() => req.type === "confirm" ? req.resolve(true) : req.resolve(draft)}
            style={{
              padding: "6px 12px", borderRadius: 5, border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
              background: req.type === "confirm" && req.danger ? "#dc2626" : "#6366f1",
            }}
          >
            {req.type === "confirm" ? "Confirm" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: TreeNode[];
  truncated?: boolean;
}

interface OpenTab {
  path: string;
  label: string;
  content: string;
  dirty: boolean;
  language: string;
}

interface ProjectMeta {
  name: string;
  path: string;
  is_current: boolean;
}

type AiMode = "ask" | "plan" | "edit" | "execute" | "debug" | "review";

const AI_MODES: { id: AiMode; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "ask",     label: "Ask",     icon: <MessageSquare size={11} />, color: "#3b82f6" },
  { id: "plan",    label: "Plan",    icon: <Sparkles size={11} />,       color: "#8b5cf6" },
  { id: "edit",    label: "Edit",    icon: <Pencil size={11} />,         color: "#10b981" },
  { id: "execute", label: "Execute", icon: <Terminal size={11} />,       color: "#f59e0b" },
  { id: "debug",   label: "Debug",   icon: <Bug size={11} />,            color: "#ef4444" },
  { id: "review",  label: "Review",  icon: <ShieldCheck size={11} />,     color: "#06b6d4" },
];

// ── Language detection ────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript",
  py: "python",
  json: "json",
  md: "markdown",
  yaml: "yaml", yml: "yaml",
  toml: "ini", ini: "ini", cfg: "ini",
  html: "html",
  css: "css", scss: "scss",
  sql: "sql",
  sh: "shell", bat: "shell",
  txt: "plaintext",
};

function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_LANG[ext] ?? "plaintext";
}

function fileLabel(path: string): string {
  return path.split("/").pop() ?? path;
}

// ── File icon ─────────────────────────────────────────────────────────────────

function FileIcon({ name, size = 13 }: { name: string; size?: number }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["ts", "tsx", "js", "jsx", "py", "sql", "sh", "bat"].includes(ext))
    return <FileCode size={size} style={{ color: "#60a5fa", flexShrink: 0 }} />;
  if (["json", "yaml", "yml", "toml", "ini", "cfg"].includes(ext))
    return <FileText size={size} style={{ color: "#a78bfa", flexShrink: 0 }} />;
  if (["md", "txt"].includes(ext))
    return <FileText size={size} style={{ color: "#94a3b8", flexShrink: 0 }} />;
  return <File size={size} style={{ color: "#64748b", flexShrink: 0 }} />;
}

// ── TreeItem ──────────────────────────────────────────────────────────────────

async function createEntry(path: string, isDir: boolean): Promise<boolean> {
  const r = await fetch(`${API}/api/ide/file/create`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, is_dir: isDir }),
  }).catch(() => null);
  if (!r?.ok) { toast.error(`Could not create: ${r ? (await r.json()).detail : "backend offline"}`); return false; }
  toast.success(`Created ${path}`);
  return true;
}

async function renameEntry(oldPath: string, newPath: string): Promise<boolean> {
  const r = await fetch(`${API}/api/ide/file/rename`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_path: oldPath, new_path: newPath }),
  }).catch(() => null);
  if (!r?.ok) { toast.error(`Could not rename: ${r ? (await r.json()).detail : "backend offline"}`); return false; }
  toast.success(`Renamed to ${newPath}`);
  return true;
}

async function deleteEntry(path: string): Promise<boolean> {
  const r = await fetch(`${API}/api/ide/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }).catch(() => null);
  if (!r?.ok) { toast.error(`Could not delete: ${r ? (await r.json()).detail : "backend offline"}`); return false; }
  toast.success(`Deleted ${path}`);
  return true;
}

function TreeItem({
  node,
  depth,
  onOpenFile,
  activeFilePath,
  onRefresh,
}: {
  node: TreeNode;
  depth: number;
  onOpenFile: (path: string) => void;
  activeFilePath: string | null;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const isActive = node.type === "file" && node.path === activeFilePath;

  useEffect(() => {
    if (!menuAt) return;
    const close = () => setMenuAt(null);
    // Next tick — otherwise the same click that opened the menu (right-click) immediately closes it
    const t = setTimeout(() => {
      window.addEventListener("click", close);
      window.addEventListener("contextmenu", close);
      window.addEventListener("scroll", close, true);
    }, 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuAt]);

  async function handleRename() {
    const name = await promptDialog("Rename to:", node.name);
    if (!name || name === node.name) return;
    const newPath = node.path.split("/").slice(0, -1).concat(name).join("/");
    if (await renameEntry(node.path, newPath)) onRefresh();
  }

  async function handleDelete() {
    if (!await confirmDialog(`Delete "${node.name}"? This cannot be undone.`, { danger: true })) return;
    if (await deleteEntry(node.path)) onRefresh();
  }

  async function handleNewChild(isDir: boolean) {
    const name = await promptDialog(isDir ? "New folder name:" : "New file name:");
    if (!name) return;
    const newPath = `${node.path}/${name}`;
    if (await createEntry(newPath, isDir)) { setOpen(true); onRefresh(); }
  }

  return (
    <div>
      <button
        onClick={() => {
          if (node.type === "dir") setOpen((o) => !o);
          else onOpenFile(node.path);
        }}
        onContextMenu={(e) => { e.preventDefault(); setMenuAt({ x: e.clientX, y: e.clientY }); }}
        title={node.path}
        style={{
          display: "flex", alignItems: "center", gap: 4, width: "100%",
          padding: `2px 6px 2px ${8 + depth * 12}px`,
          background: isActive ? "rgba(99,102,241,0.2)" : "transparent",
          border: "none", cursor: "pointer", textAlign: "left", borderRadius: 3,
          color: isActive ? "var(--color-accent)" : "var(--color-text)",
        }}
      >
        {menuAt && (
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "fixed", left: menuAt.x, top: menuAt.y, zIndex: 300,
              background: "var(--color-surface-float)", border: "1px solid var(--color-border-hi)",
              borderRadius: 6, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", padding: 4, minWidth: 140,
              display: "flex", flexDirection: "column", fontSize: 11,
            }}
          >
            {node.type === "dir" && (
              <>
                <div onClick={(e) => { e.stopPropagation(); setMenuAt(null); handleNewChild(false); }} style={{ padding: "5px 8px", cursor: "pointer", borderRadius: 4 }}>New File</div>
                <div onClick={(e) => { e.stopPropagation(); setMenuAt(null); handleNewChild(true); }} style={{ padding: "5px 8px", cursor: "pointer", borderRadius: 4 }}>New Folder</div>
              </>
            )}
            <div onClick={(e) => { e.stopPropagation(); setMenuAt(null); handleRename(); }} style={{ padding: "5px 8px", cursor: "pointer", borderRadius: 4 }}>Rename</div>
            <div onClick={(e) => { e.stopPropagation(); setMenuAt(null); handleDelete(); }} style={{ padding: "5px 8px", cursor: "pointer", borderRadius: 4, color: "#f87171" }}>Delete</div>
          </div>
        )}
        {node.type === "dir" ? (
          <>
            <span style={{ flexShrink: 0, color: "#94a3b8" }}>
              {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </span>
            {open
              ? <FolderOpen size={13} style={{ color: "#f59e0b", flexShrink: 0 }} />
              : <Folder size={13} style={{ color: "#f59e0b", flexShrink: 0 }} />
            }
          </>
        ) : (
          <>
            <span style={{ width: 11, flexShrink: 0 }} />
            <FileIcon name={node.name} />
          </>
        )}
        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
      </button>

      {node.type === "dir" && open && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
              onRefresh={onRefresh}
            />
          ))}
          {node.truncated && (
            <p style={{ fontSize: 10, color: "#64748b", paddingLeft: 8 + (depth + 1) * 12 }}>
              … truncated
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── FileTree ──────────────────────────────────────────────────────────────────

function FileTree({
  onOpenFile,
  activeFilePath,
  refreshKey,
}: {
  onOpenFile: (path: string) => void;
  activeFilePath: string | null;
  refreshKey?: number;
}) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTree = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/ide/tree`);
      if (res.ok) setTree(await res.json());
    } catch { /* backend offline */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree, refreshKey]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 8px", borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b" }}>
          EXPLORER
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <button
            onClick={async () => {
              const name = await promptDialog("New file name (path from workspace root):");
              if (!name) return;
              if (await createEntry(name, false)) fetchTree();
            }}
            title="New file"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 2 }}
          >
            <FileText size={11} />
          </button>
          <button
            onClick={async () => {
              const name = await promptDialog("New folder name (path from workspace root):");
              if (!name) return;
              if (await createEntry(name, true)) fetchTree();
            }}
            title="New folder"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 2 }}
          >
            <Folder size={11} />
          </button>
          <button
            onClick={fetchTree}
            title="Refresh tree"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 2 }}
          >
            <RefreshCw size={11} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {loading && !tree ? (
          <p style={{ fontSize: 11, color: "#64748b", padding: "8px 12px" }}>Loading tree…</p>
        ) : tree ? (
          tree.children?.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              depth={0}
              onRefresh={fetchTree}
              onOpenFile={onOpenFile}
              activeFilePath={activeFilePath}
            />
          ))
        ) : (
          <p style={{ fontSize: 11, color: "#64748b", padding: "8px 12px" }}>Could not load tree</p>
        )}
      </div>
    </div>
  );
}

// ── GitStrip ──────────────────────────────────────────────────────────────────

function GitSystem({ onCommitSuccess }: { onCommitSuccess?: () => void }) {
  const [status,  setStatus]  = useState<string>("");
  const [log,     setLog]     = useState<string>("");
  const [message, setMessage] = useState("");
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState<{ ok: boolean; output: string } | null>(null);
  const [open,    setOpen]    = useState(false);
  const [branches, setBranches] = useState<{ name: string; current: boolean }[]>([]);
  const [branchBusy, setBranchBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [sr, lr, br] = await Promise.all([
      fetch(`${API}/api/ide/git/status`).then(r => r.text()).catch(() => ""),
      fetch(`${API}/api/ide/git/log?n=8`).then(r => r.text()).catch(() => ""),
      fetch(`${API}/api/ide/git/branches`).then(r => r.json()).catch(() => ({ branches: [] })),
    ]);
    setStatus(sr.trim());
    setLog(lr.trim());
    setBranches(br.branches ?? []);
  }, []);

  async function handleSwitchBranch(name: string) {
    setBranchBusy(true);
    try {
      const r = await fetch(`${API}/api/ide/git/branch/switch`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const d = await r.json();
      setResult({ ok: d.ok, output: d.output });
      d.ok ? toast.success(`Switched to "${name}"`) : toast.error(d.output || "Switch failed");
      refresh();
    } finally { setBranchBusy(false); }
  }

  async function handleNewBranch() {
    const name = await promptDialog("New branch name:");
    if (!name) return;
    setBranchBusy(true);
    try {
      const r = await fetch(`${API}/api/ide/git/branch/create`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, checkout: true }),
      });
      const d = await r.json();
      setResult({ ok: d.ok, output: d.output });
      d.ok ? toast.success(`Created and switched to "${name}"`) : toast.error(d.output || "Branch create failed");
      refresh();
    } finally { setBranchBusy(false); }
  }

  async function handleMergeBranch() {
    const name = await promptDialog("Merge which branch into the current branch?");
    if (!name) return;
    setBranchBusy(true);
    try {
      const r = await fetch(`${API}/api/ide/git/branch/merge`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
      });
      const d = await r.json();
      setResult({ ok: d.ok, output: d.output });
      d.ok ? toast.success(`Merged "${name}"`) : toast.error(d.output || "Merge failed");
      refresh();
    } finally { setBranchBusy(false); }
  }

  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  async function handleCommit() {
    if (!message.trim()) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(`${API}/api/ide/git/commit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: message.trim() }),
      });
      const d = await r.json();
      setResult({ ok: d.ok, output: d.output ?? d.message ?? "" });
      if (d.ok) { setMessage(""); refresh(); onCommitSuccess?.(); }
    } catch (e: unknown) {
      setResult({ ok: false, output: String(e) });
    } finally {
      setBusy(false);
    }
  }

  const changedCount = status.split("\n").filter(Boolean).length;

  return (
    <div style={{ borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          padding: "6px 8px", background: "none", border: "none",
          cursor: "pointer", color: "var(--color-text)",
        }}
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <GitBranch size={11} style={{ color: "#64748b" }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", color: "#64748b", flex: 1, textAlign: "left" }}>
          GIT SOURCE CONTROL
        </span>
        {changedCount > 0 && (
          <span style={{
            fontSize: 9, background: "rgba(245,158,11,0.15)", color: "#f59e0b",
            borderRadius: 8, padding: "1px 5px", fontWeight: 700,
          }}>
            {changedCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding: "0 8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {/* Branch controls */}
          {branches.length === 0 ? (
            <p style={{ fontSize: 10, color: "#64748b", margin: 0 }}>Not a git repository</p>
          ) : (
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <select
              value={branches.find(b => b.current)?.name ?? ""}
              onChange={e => handleSwitchBranch(e.target.value)}
              disabled={branchBusy}
              title={branches.find(b => b.current)?.name ?? ""}
              style={{
                flex: 1, fontSize: 10, background: "var(--color-surface-raised)",
                border: "1px solid var(--color-border)", borderRadius: 4, padding: "3px 6px",
                color: "var(--color-text-primary)",
              }}
            >
              {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
            </select>
            <button onClick={handleNewBranch} disabled={branchBusy} title="Create new branch"
              style={{ fontSize: 9, padding: "3px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", cursor: "pointer" }}>
              + Branch
            </button>
            <button onClick={handleMergeBranch} disabled={branchBusy} title="Merge a branch into current"
              style={{ fontSize: 9, padding: "3px 6px", borderRadius: 4, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", cursor: "pointer" }}>
              Merge
            </button>
          </div>
          )}

          {status ? (
            <pre style={{
              fontSize: 9, margin: 0, fontFamily: "monospace",
              background: "rgba(0,0,0,0.2)", borderRadius: 4,
              padding: "5px 7px", overflowX: "auto", color: "#94a3b8",
              maxHeight: 90, overflowY: "auto",
            }}>
              {status}
            </pre>
          ) : (
            <p style={{ fontSize: 10, color: "#22c55e", margin: 0 }}>✓ Working tree clean</p>
          )}

          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Commit message…"
            rows={2}
            style={{
              width: "100%", resize: "none", fontSize: 11,
              background: "var(--color-bg)", border: "1px solid var(--color-border)",
              borderRadius: 4, padding: "5px 7px", color: "var(--color-text)",
              fontFamily: "inherit", boxSizing: "border-box",
            }}
          />

          <button
            onClick={handleCommit}
            disabled={busy || !message.trim()}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
              color: "#818cf8", borderRadius: 5, padding: "5px 0", fontSize: 11,
              fontWeight: 700, cursor: busy || !message.trim() ? "not-allowed" : "pointer",
              opacity: busy || !message.trim() ? 0.5 : 1, width: "100%",
            }}
          >
            <GitCommit size={12} />
            {busy ? "Committing…" : "Stage All & Commit"}
          </button>

          {result && (
            <pre style={{
              fontSize: 9, margin: 0, fontFamily: "monospace",
              color: result.ok ? "#22c55e" : "#f87171",
              background: "rgba(0,0,0,0.2)", borderRadius: 4,
              padding: "4px 6px", whiteSpace: "pre-wrap", wordBreak: "break-all",
              maxHeight: 80, overflowY: "auto",
            }}>
              {result.output}
            </pre>
          )}

          {log && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 3, display: "flex", alignItems: "center", gap: 4 }}>
                <GitPullRequest size={9} /> Recent Commits
              </div>
              <pre style={{
                fontSize: 9, margin: 0, fontFamily: "monospace",
                color: "#64748b", background: "rgba(0,0,0,0.15)",
                borderRadius: 4, padding: "4px 6px",
                whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 90, overflowY: "auto",
              }}>
                {log}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── ActivityFeed ──────────────────────────────────────────────────────────────

interface IdeEvent {
  ts:        string;
  agent:     string;
  action:    string;
  file?:     string;
  reason?:   string;
  command?:  string;
  ok?:       boolean;
  output?:   string;
  old?:      string;
  new?:      string;
  summary?:  string;
  confidence?: number;
  heartbeat?: boolean;
}

function ActivityFeed() {
  const [events, setEvents] = useState<IdeEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`${API}/api/ide/events`);
    es.onopen    = () => setConnected(true);
    es.onerror   = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const ev: IdeEvent = JSON.parse(e.data);
        if (ev.heartbeat) return;
        setEvents(prev => [ev, ...prev].slice(0, 200));
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "6px 10px", borderBottom: "1px solid var(--color-border)", flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "#64748b" }}>
          ACTIVITY LOG
        </span>
        <span style={{
          fontSize: 9, padding: "1px 5px", borderRadius: 8,
          background: connected ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.15)",
          color: connected ? "#22c55e" : "#64748b",
        }}>
          {connected ? "● live" : "○ off"}
        </span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
        {events.length === 0 ? (
          <p style={{ fontSize: 11, color: "#475569", padding: "10px 0" }}>
            Waiting for agent activity…
          </p>
        ) : (
          events.map((ev, i) => (
            <div key={i} style={{ fontSize: 11, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ color: "#94a3b8", fontWeight: 600 }}>[{ev.agent}]</span> {ev.action} {ev.file || ev.command || ""}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── AI Command Panel (Right Side) ─────────────────────────────────────────────

interface IndexStatus {
  chunk_count: number;
  indexed: boolean;
  last_indexed_at: string | null;
}

// Live agent execution — text tokens interleaved with real tool calls (run_command, write_file, …)
type AgentBlock =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; args: Record<string, unknown>; status: "running" | "done"; preview?: Record<string, unknown> }
  | { type: "approval"; id: string; name: string; approvalId: string }
  | { type: "error"; text: string };

/** Parse one complete SSE "data: ..." frame into a block-stream update. Mutates `blocks` via setBlocks. */
function applySseFrame(
  raw: string,
  setBlocks: React.Dispatch<React.SetStateAction<AgentBlock[]>>,
): boolean /* isDone */ {
  const line = raw.startsWith("data: ") ? raw.slice(6) : raw;
  if (line === "[DONE]") return true;

  if (line.startsWith("[TOOL_RESULT]")) {
    try {
      const { id, preview } = JSON.parse(line.slice("[TOOL_RESULT]".length));
      setBlocks(prev => prev.map(b => (b.type === "tool" && b.id === id) ? { ...b, status: "done", preview } : b));
    } catch { /* ignore malformed frame */ }
    return false;
  }
  if (line.startsWith("[TOOL]")) {
    try {
      const { id, name, args } = JSON.parse(line.slice("[TOOL]".length));
      setBlocks(prev => [...prev, { type: "tool", id, name, args, status: "running" }]);
    } catch { /* ignore */ }
    return false;
  }
  if (line.startsWith("[APPROVAL]")) {
    try {
      const { id, name, approval_id } = JSON.parse(line.slice("[APPROVAL]".length));
      setBlocks(prev => [...prev, { type: "approval", id, name, approvalId: approval_id }]);
    } catch { /* ignore */ }
    return false;
  }
  if (line.startsWith("[ERROR]")) {
    try {
      const { error } = JSON.parse(line.slice("[ERROR]".length));
      setBlocks(prev => [...prev, { type: "error", text: error }]);
    } catch { /* ignore */ }
    return false;
  }

  // Plain text token — backend escapes real newlines as literal "\n"
  const text = line.replace(/\\n/g, "\n");
  if (text) {
    setBlocks(prev => {
      const last = prev[prev.length - 1];
      if (last && last.type === "text") {
        return [...prev.slice(0, -1), { type: "text", text: last.text + text }];
      }
      return [...prev, { type: "text", text }];
    });
  }
  return false;
}

function AiAgentCommandPanel({ activeFilePath }: { activeFilePath: string | null }) {
  const [mode, setMode] = useState<AiMode>("plan");
  const [prompt, setPrompt] = useState("");
  const [agent, setAgent] = useState("jazper");
  const [streaming, setStreaming] = useState(false);
  const [blocks, setBlocks] = useState<AgentBlock[]>([]);
  const [indexStatus, setIndexStatus] = useState<IndexStatus | null>(null);
  const [indexing, setIndexing] = useState(false);

  const selectedModeObj = AI_MODES.find(m => m.id === mode)!;

  const refreshIndexStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/ide/index/status`);
      if (r.ok) setIndexStatus(await r.json());
    } catch { /* backend offline */ }
  }, []);

  useEffect(() => { refreshIndexStatus(); }, [refreshIndexStatus]);

  async function handleBuildIndex() {
    if (indexing) return;
    setIndexing(true);
    try {
      await fetch(`${API}/api/ide/index/build`, { method: "POST" });
      await refreshIndexStatus();
    } catch { /* backend offline */ }
    finally { setIndexing(false); }
  }

  async function handleSend() {
    if (!prompt.trim() || streaming) return;
    setStreaming(true);
    setBlocks([]);

    let contextBlock = "";
    try {
      const cr = await fetch(`${API}/api/ide/context/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: prompt, top_k: 5 }),
      });
      if (cr.ok) {
        const { results } = await cr.json();
        if (Array.isArray(results) && results.length > 0) {
          contextBlock = "\n\n[RELEVANT CODE CONTEXT]\n" + results.map((r: {
            file_path: string; symbol_name?: string; start_line: number; end_line: number; content: string;
          }) =>
            `--- ${r.file_path}${r.symbol_name ? `::${r.symbol_name}` : ""} (L${r.start_line}-${r.end_line}) ---\n${r.content}`
          ).join("\n\n");
        }
      }
    } catch { /* index not built / backend offline — proceed without context */ }

    const fullMsg = `[IDE MODE: ${mode.toUpperCase()}] ${activeFilePath ? `[Active File: ${activeFilePath}] ` : ""}${prompt}${contextBlock}`;

    try {
      const res = await fetch(`${API}/api/direct/agent/${agent}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: fullMsg }),
      });

      if (!res.body) {
        setBlocks([{ type: "error", text: "Empty response from agent" }]);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        let sepIdx: number;
        while ((sepIdx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, sepIdx);
          buf = buf.slice(sepIdx + 2);
          if (!frame.trim()) continue;
          if (applySseFrame(frame, setBlocks)) break outer;
        }
      }
    } catch (e) {
      setBlocks(prev => [...prev, { type: "error", text: `Execution failed: ${e}` }]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div style={{
      width: 300, flexShrink: 0,
      borderLeft: "1px solid var(--color-border)",
      background: "var(--color-surface)",
      display: "flex", flexDirection: "column",
      height: "100%", overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "8px 12px", borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Bot size={14} style={{ color: selectedModeObj.color }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)" }}>
            AI COMMAND CENTER
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={handleBuildIndex}
            disabled={indexing}
            title={indexStatus?.indexed ? `${indexStatus.chunk_count} chunks indexed` : "Build semantic code index"}
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: indexStatus?.indexed ? "rgba(34,197,94,0.12)" : "rgba(100,116,139,0.15)",
              border: "1px solid " + (indexStatus?.indexed ? "rgba(34,197,94,0.3)" : "var(--color-border)"),
              borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 700,
              color: indexStatus?.indexed ? "#22c55e" : "var(--color-text-muted)",
              cursor: indexing ? "not-allowed" : "pointer",
            }}
          >
            <Layers size={10} style={{ animation: indexing ? "spin 1s linear infinite" : "none" }} />
            {indexing ? "Indexing…" : indexStatus?.indexed ? `${indexStatus.chunk_count}` : "Index"}
          </button>
          <select
          value={agent}
          onChange={e => setAgent(e.target.value)}
          style={{
            background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
            borderRadius: 4, padding: "2px 6px", fontSize: 10, color: "var(--color-text-primary)",
            outline: "none", cursor: "pointer",
          }}
        >
          <option value="jazper">Jazper (Orchestrator)</option>
          <option value="forge">Forge (Developer)</option>
          <option value="oracle">Oracle (Diagnostician)</option>
          <option value="shield">Shield (QA Agent)</option>
          <option value="commander">Commander (DevOps)</option>
          </select>
        </div>
      </div>

      {/* Mode Selector */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4,
        padding: "8px 12px", borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}>
        {AI_MODES.map(m => {
          const isActive = mode === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                padding: "4px 0", borderRadius: 5, border: "1px solid",
                borderColor: isActive ? m.color : "transparent",
                background: isActive ? `${m.color}22` : "var(--color-surface-raised)",
                color: isActive ? m.color : "var(--color-text-muted)",
                fontSize: 10, fontWeight: 600, cursor: "pointer",
                transition: "all 0.12s ease",
              }}
            >
              {m.icon}
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Active File Context Chip */}
      {activeFilePath && (
        <div style={{ padding: "6px 12px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <div title={activeFilePath} style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 8px", borderRadius: 4, background: "rgba(99,102,241,0.1)",
            border: "1px solid rgba(99,102,241,0.2)", fontSize: 10, color: "var(--color-text-secondary)",
          }}>
            <Code2 size={11} style={{ color: "#818cf8" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
              {activeFilePath}
            </span>
          </div>
        </div>
      )}

      {/* Stream Output / Checklist Area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", fontSize: 11, lineHeight: 1.6 }}>
        {blocks.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {blocks.map((b, i) => {
              if (b.type === "text") {
                return (
                  <pre key={i} style={{
                    whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-sans)",
                    color: "var(--color-text-primary)", margin: 0,
                  }}>
                    {b.text}
                  </pre>
                );
              }
              if (b.type === "error") {
                return (
                  <div key={i} style={{ color: "#f87171", fontSize: 10, background: "rgba(239,68,68,0.08)", borderRadius: 4, padding: "4px 8px" }}>
                    ⚠ {b.text}
                  </div>
                );
              }
              if (b.type === "approval") {
                return (
                  <div key={i} style={{ color: "#f59e0b", fontSize: 10, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 4, padding: "6px 8px" }}>
                    ⏸ Waiting for approval to run <b>{b.name}</b> — check the Approvals panel.
                  </div>
                );
              }
              // Live tool call — this is the "watch the agent work" block
              const preview = b.preview as { ok?: boolean; summary?: string; preview?: string } | undefined;
              return (
                <div key={i} style={{
                  fontFamily: "monospace", fontSize: 10, borderRadius: 5,
                  border: "1px solid var(--color-border)", background: "var(--color-surface-raised)",
                  overflow: "hidden",
                }}>
                  <div style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                    background: b.status === "running" ? "rgba(99,102,241,0.12)" : "rgba(34,197,94,0.08)",
                    color: b.status === "running" ? "#818cf8" : "#22c55e", fontWeight: 700,
                  }}>
                    {b.status === "running" ? <Cpu size={10} style={{ animation: "spin 1.2s linear infinite" }} /> : <CheckCircle size={10} />}
                    {b.name}
                    {typeof b.args?.command === "string" && <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>· {String(b.args.command)}</span>}
                    {typeof b.args?.path === "string" && <span style={{ color: "var(--color-text-muted)", fontWeight: 400 }}>· {String(b.args.path)}</span>}
                  </div>
                  {preview && (
                    <pre style={{
                      margin: 0, padding: "6px 8px", whiteSpace: "pre-wrap", wordBreak: "break-all",
                      color: preview.ok === false ? "#f87171" : "var(--color-text-secondary)",
                      maxHeight: 140, overflowY: "auto",
                    }}>
                      {[preview.summary, preview.preview].filter(Boolean).join("\n") || JSON.stringify(preview)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: "center", color: "var(--color-text-muted)", marginTop: 40 }}>
            <Sparkles size={24} style={{ color: selectedModeObj.color, opacity: 0.5, marginBottom: 8 }} />
            <p style={{ fontWeight: 600, color: "var(--color-text-secondary)" }}>Mode: {selectedModeObj.label}</p>
            <p style={{ fontSize: 10, marginTop: 4 }}>
              Describe what you want to {mode === "edit" ? "build or change" : mode === "plan" ? "plan out" : "analyze"}…
            </p>
          </div>
        )}
      </div>

      {/* Input Box */}
      <div style={{ padding: "8px 12px 12px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{
          display: "flex", gap: 6, background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border-hi)", borderRadius: 6, padding: "6px 8px",
        }}>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={`Instruct ${agent} in ${selectedModeObj.label} mode…`}
            rows={2}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              fontSize: 11, color: "var(--color-text-primary)", resize: "none",
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleSend}
            disabled={streaming || !prompt.trim()}
            style={{
              width: 28, height: 28, borderRadius: 5, border: "none",
              background: selectedModeObj.color, color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: streaming || !prompt.trim() ? "not-allowed" : "pointer",
              opacity: streaming || !prompt.trim() ? 0.4 : 1,
              alignSelf: "flex-end", flexShrink: 0,
            }}
          >
            <SendHorizontal size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Multi-tab Terminal (Phase 4 — real command execution) ────────────────────

interface TermLine { kind: string; text: string; ts: number }
interface TermSession { id: string; label: string }

function TerminalDrawer() {
  const [sessions, setSessions] = useState<TermSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lines, setLines] = useState<TermLine[]>([]);
  const [running, setRunning] = useState(false);
  const [command, setCommand] = useState("");
  const [portInput, setPortInput] = useState("3000");
  const [portMsg, setPortMsg] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const createTerminal = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/ide/terminal/create`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: `Terminal ${sessions.length + 1}` }),
      });
      if (r.ok) {
        const s: TermSession = await r.json();
        setSessions(prev => [...prev, s]);
        setActiveId(s.id);
      }
    } catch { /* backend offline */ }
  }, [sessions.length]);

  // Create a first terminal on mount
  useEffect(() => { if (sessions.length === 0) createTerminal(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Connect SSE to whichever terminal is active
  useEffect(() => {
    esRef.current?.close();
    setLines([]);
    if (!activeId) return;
    const es = new EventSource(`${API}/api/ide/terminal/${activeId}/stream`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.heartbeat) return;
        if (payload.kind === "exit" || payload.kind === "error") setRunning(false);
        setLines(prev => [...prev, payload]);
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines]);

  async function closeTerminal(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`${API}/api/ide/terminal/${id}`, { method: "DELETE" }).catch(() => {});
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      if (activeId === id) setActiveId(next[0]?.id ?? null);
      return next;
    });
  }

  async function runCommand() {
    if (!command.trim() || !activeId || running) return;
    setRunning(true);
    try {
      const r = await fetch(`${API}/api/ide/terminal/${activeId}/run`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: command.trim() }),
      });
      if (!r.ok) setRunning(false);
    } catch { setRunning(false); }
    setCommand("");
  }

  async function stopCommand() {
    if (!activeId) return;
    await fetch(`${API}/api/ide/terminal/${activeId}/kill`, { method: "POST" }).catch(() => {});
  }

  async function handleFreePort() {
    const port = Number(portInput);
    if (!port) return;
    setPortMsg("Checking…");
    try {
      const r = await fetch(`${API}/api/ide/port/free`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port }),
      });
      const d = await r.json();
      setPortMsg(d.message ?? (d.ok ? "Freed" : "Failed"));
    } catch (e) { setPortMsg(`Error: ${e}`); }
  }

  async function handleNextFree() {
    const start = Number(portInput) || 3000;
    try {
      const r = await fetch(`${API}/api/ide/port/next-free?start=${start}`);
      const d = await r.json();
      setPortInput(String(d.port));
      setPortMsg(`Next free port: ${d.port}`);
    } catch (e) { setPortMsg(`Error: ${e}`); }
  }

  const lineColor: Record<string, string> = {
    cmd: "#a78bfa", stdout: "#cbd5e1", stderr: "#f87171",
    exit: "#64748b", error: "#f87171", system: "#f59e0b",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Tabs + port tools */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "3px 6px",
        borderBottom: "1px solid var(--color-border)", flexShrink: 0, overflowX: "auto",
      }}>
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "2px 8px",
              borderRadius: 4, border: "none", cursor: "pointer", whiteSpace: "nowrap",
              background: activeId === s.id ? "var(--color-surface-float)" : "transparent",
              color: activeId === s.id ? "#a78bfa" : "var(--color-text-muted)",
              fontSize: 10, fontWeight: 600,
            }}
          >
            <Terminal size={10} /> {s.label}
            <span onClick={(e) => closeTerminal(s.id, e)} style={{ display: "flex", color: "#64748b" }}>
              <X size={10} />
            </span>
          </button>
        ))}
        <button
          onClick={createTerminal}
          title="New terminal"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: "2px 6px", fontSize: 13 }}
        >
          +
        </button>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <input
            value={portInput}
            onChange={e => setPortInput(e.target.value)}
            placeholder="port"
            style={{
              width: 56, fontSize: 10, background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)", borderRadius: 4, padding: "2px 5px",
              color: "var(--color-text-primary)",
            }}
          />
          <button onClick={handleFreePort} title="Kill whatever is listening on this port"
            style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", cursor: "pointer" }}>
            Free Port
          </button>
          <button onClick={handleNextFree} title="Find the next available port"
            style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", cursor: "pointer" }}>
            Next Free
          </button>
          {portMsg && <span style={{ fontSize: 9, color: "#64748b", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{portMsg}</span>}
        </div>
      </div>

      {/* Output */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "6px 10px", fontFamily: "monospace", fontSize: 11 }}>
        {lines.length === 0 && (
          <div style={{ color: "#64748b" }}>Terminal ready. Type a command below and press Enter.</div>
        )}
        {lines.map((l, i) => (
          <div key={i} style={{ color: lineColor[l.kind] ?? "#cbd5e1", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {l.text}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
        <span style={{ color: "#a78bfa", fontFamily: "monospace", fontSize: 12 }}>$</span>
        <input
          value={command}
          onChange={e => setCommand(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") runCommand(); }}
          disabled={!activeId || running}
          placeholder={running ? "Command running…" : "Type a command…"}
          style={{
            flex: 1, background: "transparent", border: "none", outline: "none",
            fontFamily: "monospace", fontSize: 12, color: "var(--color-text-primary)",
          }}
        />
        {running ? (
          <button onClick={stopCommand} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", cursor: "pointer" }}>
            Stop
          </button>
        ) : (
          <button onClick={runCommand} disabled={!command.trim()} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", cursor: "pointer" }}>
            Run
          </button>
        )}
      </div>
    </div>
  );
}

// ── Live Browser Preview (Phase 5 lite) ───────────────────────────────────────

function BrowserPreview() {
  const [url, setUrl] = useState("http://localhost:3001");
  const [input, setInput] = useState(url);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  async function detectLivePort() {
    setBusy(true);
    try {
      for (const port of [3000, 5173, 8080, 4000]) {
        const r = await fetch(`${API}/api/ide/port/check?port=${port}`).catch(() => null);
        if (r?.ok) {
          const d = await r.json();
          if (d.in_use) { setInput(`http://localhost:${port}`); setUrl(`http://localhost:${port}`); break; }
        }
      }
    } finally { setBusy(false); }
  }

  function go() { setUrl(input); setReloadKey(k => k + 1); }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
        borderBottom: "1px solid var(--color-border)", flexShrink: 0,
      }}>
        <button onClick={() => setReloadKey(k => k + 1)} title="Reload"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", display: "flex" }}>
          <RefreshCw size={12} />
        </button>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") go(); }}
          style={{
            flex: 1, fontSize: 11, background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border)", borderRadius: 4, padding: "3px 8px",
            color: "var(--color-text-primary)", fontFamily: "monospace",
          }}
        />
        <button onClick={go} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", cursor: "pointer" }}>
          Go
        </button>
        <button onClick={detectLivePort} disabled={busy} title="Auto-detect a running dev server port"
          style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", cursor: "pointer" }}>
          {busy ? "…" : "Detect"}
        </button>
        <button onClick={() => window.open(url, "_blank")} title="Open in a new browser tab"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", display: "flex" }}>
          <Eye size={12} />
        </button>
      </div>
      <div style={{ flex: 1, background: "#fff" }}>
        <iframe key={reloadKey} src={url} style={{ width: "100%", height: "100%", border: "none" }} />
      </div>
    </div>
  );
}

// ── Problems Panel (structured build/test errors) ─────────────────────────────

interface BuildError { file?: string; line?: number; message: string }
interface CheckResult {
  ok?: boolean; command?: string; error?: string;
  error_count?: number; errors?: BuildError[];
  failure_count?: number; failures?: { test?: string; msg?: string }[];
  raw_tail?: string;
}

function ProblemsPanel({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const [build, setBuild] = useState<CheckResult | null>(null);
  const [tests, setTests] = useState<CheckResult | null>(null);
  const [busy, setBusy] = useState<"build" | "tests" | null>(null);

  async function runCheck() {
    setBusy("build");
    try {
      const r = await fetch(`${API}/api/ide/problems/check`, { method: "POST" });
      setBuild(await r.json());
    } catch (e) { setBuild({ error: String(e) }); }
    finally { setBusy(null); }
  }

  async function runTests() {
    setBusy("tests");
    try {
      const r = await fetch(`${API}/api/ide/problems/tests`, { method: "POST" });
      setTests(await r.json());
    } catch (e) { setTests({ error: String(e) }); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 6, padding: "5px 8px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <button onClick={runCheck} disabled={busy !== null}
          style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#818cf8", cursor: "pointer" }}>
          {busy === "build" ? "Checking…" : "Run Build Check"}
        </button>
        <button onClick={runTests} disabled={busy !== null}
          style={{ fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.3)", color: "#22c55e", cursor: "pointer" }}>
          {busy === "tests" ? "Running…" : "Run Tests"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", fontSize: 11 }}>
        {!build && !tests && (
          <div style={{ color: "#64748b" }}>Run a build check or test run to see structured errors here.</div>
        )}
        {build && (
          <div style={{ marginBottom: 12 }}>
            {build.error ? (
              <div style={{ color: "#f59e0b" }}>⚠ {build.error}</div>
            ) : build.ok ? (
              <div style={{ color: "#22c55e" }}>✓ Build clean — <code>{build.command}</code></div>
            ) : (
              <>
                <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 4 }}>
                  ✗ {build.error_count} build error(s) — <code>{build.command}</code>
                </div>
                {(build.errors ?? []).map((e, i) => (
                  <div key={i}
                    onClick={() => e.file && onOpenFile(e.file)}
                    style={{ cursor: e.file ? "pointer" : "default", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ color: "#818cf8" }}>{e.file}{e.line ? `:${e.line}` : ""}</span>{" "}
                    <span style={{ color: "var(--color-text-secondary)" }}>{e.message}</span>
                  </div>
                ))}
                {build.raw_tail && (build.errors ?? []).length === 0 && (
                  <pre style={{ whiteSpace: "pre-wrap", color: "#94a3b8", fontSize: 10 }}>{build.raw_tail}</pre>
                )}
              </>
            )}
          </div>
        )}
        {tests && (
          <div>
            {tests.error ? (
              <div style={{ color: "#f59e0b" }}>⚠ {tests.error}</div>
            ) : tests.ok ? (
              <div style={{ color: "#22c55e" }}>✓ Tests passed — <code>{tests.command}</code></div>
            ) : (
              <>
                <div style={{ color: "#f87171", fontWeight: 700, marginBottom: 4 }}>
                  ✗ {tests.failure_count} test failure(s) — <code>{tests.command}</code>
                </div>
                {(tests.failures ?? []).map((f, i) => (
                  <div key={i} style={{ padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <span style={{ color: "#f87171" }}>FAILED</span>{" "}
                    <span style={{ color: "var(--color-text-secondary)" }}>{f.test}</span>
                  </div>
                ))}
                {tests.raw_tail && (tests.failures ?? []).length === 0 && (
                  <pre style={{ whiteSpace: "pre-wrap", color: "#94a3b8", fontSize: 10 }}>{tests.raw_tail}</pre>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Quick Open (Ctrl+P) ────────────────────────────────────────────────────────

function flattenTree(node: TreeNode, out: string[] = []): string[] {
  if (node.type === "file") out.push(node.path);
  node.children?.forEach(c => flattenTree(c, out));
  return out;
}

function QuickOpenModal({ onOpenFile, onClose }: { onOpenFile: (path: string) => void; onClose: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    fetch(`${API}/api/ide/tree`).then(r => r.json()).then(tree => setFiles(flattenTree(tree))).catch(() => {});
  }, []);

  const matches = query
    ? files.filter(f => f.toLowerCase().includes(query.toLowerCase())).slice(0, 30)
    : files.slice(0, 30);

  function pick(path: string) { onOpenFile(path); onClose(); }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 250, display: "flex", justifyContent: "center", paddingTop: "10vh" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, maxHeight: "60vh", background: "var(--color-surface)", border: "1px solid var(--color-border-hi)", borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <input
          autoFocus
          value={query}
          onChange={e => { setQuery(e.target.value); setSelected(0); }}
          onKeyDown={e => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelected(s => Math.min(s + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
            else if (e.key === "Enter" && matches[selected]) { pick(matches[selected]); }
            else if (e.key === "Escape") onClose();
          }}
          placeholder="Go to file…"
          style={{ padding: "10px 14px", background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--color-text-primary)", borderBottom: "1px solid var(--color-border)" }}
        />
        <div style={{ overflowY: "auto" }}>
          {matches.map((f, i) => (
            <div key={f} onClick={() => pick(f)} style={{ padding: "6px 14px", fontSize: 12, cursor: "pointer", background: i === selected ? "rgba(99,102,241,0.15)" : "transparent", color: "var(--color-text-primary)" }}>
              {f}
            </div>
          ))}
          {matches.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12, color: "#64748b" }}>No matching files</div>}
        </div>
      </div>
    </div>
  );
}

// ── Global Search (Ctrl+Shift+F) ──────────────────────────────────────────────

function GlobalSearchModal({ onOpenFile, onClose }: { onOpenFile: (path: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ file_path: string; line: number; text: string }[]>([]);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const r = await fetch(`${API}/api/ide/context/grep?query=${encodeURIComponent(query)}&max_results=100`);
      const d = await r.json();
      setResults(d.results ?? []);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 250, display: "flex", justifyContent: "center", paddingTop: "8vh" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 560, maxHeight: "70vh", background: "var(--color-surface)", border: "1px solid var(--color-border-hi)", borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)" }}>
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") runSearch(); if (e.key === "Escape") onClose(); }}
            placeholder="Search across all files…"
            style={{ flex: 1, padding: "10px 14px", background: "transparent", border: "none", outline: "none", fontSize: 13, color: "var(--color-text-primary)" }}
          />
          <button onClick={runSearch} style={{ padding: "0 16px", background: "none", border: "none", color: "#818cf8", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>
            {searching ? "…" : "Search"}
          </button>
        </div>
        <div style={{ overflowY: "auto" }}>
          {results.map((r, i) => (
            <div key={i} onClick={() => { onOpenFile(r.file_path); onClose(); }} style={{ padding: "6px 14px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: 11, color: "#818cf8" }}>{r.file_path}:{r.line}</div>
              <div style={{ fontSize: 11, color: "var(--color-text-secondary)", whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis" }}>{r.text}</div>
            </div>
          ))}
          {results.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12, color: "#64748b" }}>{searching ? "Searching…" : "No results yet"}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Resize handle ─────────────────────────────────────────────────────────────

function ResizeHandle({ direction = "vertical" }: { direction?: "vertical" | "horizontal" }) {
  return (
    <PanelResizeHandle
      style={{
        flexShrink: 0,
        background: "var(--color-border)",
        position: "relative",
        ...(direction === "vertical" ? { width: 5, cursor: "col-resize" } : { height: 5, cursor: "row-resize" }),
      }}
      className="sj-resize-handle"
    />
  );
}

// ── IDE Settings Modal ────────────────────────────────────────────────────────

function IdeSettingsModal({
  settings, onSave, onClose,
}: { settings: IdeSettings; onSave: (s: IdeSettings) => void; onClose: () => void }) {
  const [draft, setDraft] = useState<IdeSettings>(settings);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 380, background: "var(--color-surface)", border: "1px solid var(--color-border-hi)",
          borderRadius: 8, padding: 16, boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <SettingsIcon size={14} style={{ color: "#6366f1" }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-primary)" }}>IDE SETTINGS</span>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Theme */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <Palette size={11} /> EDITOR THEME
            </span>
            <select
              value={draft.theme}
              onChange={e => setDraft(d => ({ ...d, theme: e.target.value as IdeSettings["theme"] }))}
              style={{
                background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                borderRadius: 4, padding: "5px 8px", fontSize: 11, color: "var(--color-text-primary)",
              }}
            >
              {IDE_THEME_PRESETS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>

          {/* Font family */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <Type size={11} /> FONT FAMILY
            </span>
            <select
              value={draft.fontFamily}
              onChange={e => setDraft(d => ({ ...d, fontFamily: e.target.value }))}
              style={{
                background: "var(--color-surface-raised)", border: "1px solid var(--color-border)",
                borderRadius: 4, padding: "5px 8px", fontSize: 11, color: "var(--color-text-primary)",
              }}
            >
              {IDE_FONT_PRESETS.map(f => <option key={f} value={f}>{f.split(",")[0].replace(/'/g, "")}</option>)}
            </select>
          </label>

          {/* Font size */}
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)" }}>
              FONT SIZE — {draft.fontSize}px
            </span>
            <input
              type="range" min={10} max={22} step={1}
              value={draft.fontSize}
              onChange={e => setDraft(d => ({ ...d, fontSize: Number(e.target.value) }))}
            />
          </label>

          {/* Autosave */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: 4 }}>
              <Clock size={11} /> AUTOSAVE
            </span>
            <input
              type="checkbox"
              checked={draft.autosave}
              onChange={e => setDraft(d => ({ ...d, autosave: e.target.checked }))}
            />
          </div>
          {draft.autosave && (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                Save {Math.round(draft.autosaveIntervalMs / 100) / 10}s after you stop typing
              </span>
              <input
                type="range" min={500} max={5000} step={250}
                value={draft.autosaveIntervalMs}
                onChange={e => setDraft(d => ({ ...d, autosaveIntervalMs: Number(e.target.value) }))}
              />
            </label>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 5, border: "1px solid var(--color-border)",
              background: "none", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => { onSave(draft); toast.success("IDE settings saved"); onClose(); }}
            style={{
              flex: 1, padding: "7px 0", borderRadius: 5,
              background: "#6366f1", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main IDEPanel ─────────────────────────────────────────────────────────────

export function IDEPanel() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [currentProject, setCurrentProject] = useState<string>("");
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<"terminal" | "activity" | "browser" | "problems">("terminal");
  const [refreshTreeKey, setRefreshTreeKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const { settings: ideSettings, save: saveIdeSettings } = useIdeSettings();
  const backendUp = useBackendHealth();

  const editorRef = useRef<unknown>(null);
  const explorerPanelRef = useRef<ImperativePanelHandle>(null);
  const aiPanelRef = useRef<ImperativePanelHandle>(null);
  const activeTabData = tabs.find((t) => t.path === activeTab) ?? null;

  // Fetch workspaces
  const fetchProjects = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/ide/projects`);
      if (r.ok) {
        const data = await r.json();
        setProjects(data.projects);
        setCurrentProject(data.current);
      }
    } catch { /* backend offline */ }
  }, []);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  // Select project
  async function handleSelectProject(path: string) {
    const dirtyCount = tabs.filter(t => t.dirty).length;
    if (dirtyCount > 0 && !await confirmDialog(
      `You have ${dirtyCount} unsaved file${dirtyCount > 1 ? "s" : ""}. Switching workspace will discard those changes. Continue?`,
      { danger: true },
    )) return;
    try {
      const r = await fetch(`${API}/api/ide/project/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (r.ok) {
        const data = await r.json();
        setCurrentProject(data.path);
        setTabs([]);
        setActiveTab(null);
        setRefreshTreeKey(k => k + 1);
      }
    } catch (e) {
      toast.error(`Could not switch workspace: ${e}`);
    }
  }

  // Open file
  const openFile = useCallback(async (path: string) => {
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveTab(path);
      return;
    }
    try {
      const res = await fetch(`${API}/api/ide/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) { toast.error(`Cannot open file: ${(await res.json()).detail}`); return; }
      const { content } = await res.json();
      const tab: OpenTab = {
        path,
        label: fileLabel(path),
        content,
        dirty: false,
        language: detectLanguage(path),
      };
      setTabs((prev) => [...prev, tab]);
      setActiveTab(path);
    } catch (e) {
      toast.error(`Failed to read file: ${e}`);
    }
  }, [tabs]);

  // Close tab
  const closeTab = useCallback(async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const tab = tabs.find(t => t.path === path);
    if (tab?.dirty && !await confirmDialog(`"${tab.label}" has unsaved changes. Close without saving?`, { danger: true })) {
      return;
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTab === path) {
        const idx = prev.findIndex((t) => t.path === path);
        const fallback = next[Math.max(0, idx - 1)];
        setActiveTab(fallback?.path ?? null);
      }
      return next;
    });
  }, [activeTab, tabs]);

  // Handle editor changes
  const handleChange = useCallback((value: string | undefined) => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) => t.path === activeTab ? { ...t, content: value ?? "", dirty: true } : t)
    );
  }, [activeTab]);

  // Save active file
  const saveActive = useCallback(async () => {
    if (!activeTabData || !activeTabData.dirty) return;
    setSaving(true);
    try {
      const res = await fetch(
        `${API}/api/ide/file?path=${encodeURIComponent(activeTabData.path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: activeTabData.content }),
        },
      );
      if (res.ok) {
        setTabs((prev) => prev.map((t) => t.path === activeTabData.path ? { ...t, dirty: false } : t));
        toast.success(`Saved ${activeTabData.label}`);
      } else {
        toast.error(`Save failed: ${(await res.json()).detail}`);
      }
    } catch (e) {
      toast.error(`Save failed: ${e}`);
    } finally {
      setSaving(false);
    }
  }, [activeTabData]);

  // Ctrl+S save · Ctrl+P quick-open · Ctrl+Shift+F global search
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "s") { e.preventDefault(); saveActive(); }
      else if (mod && !e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); setShowQuickOpen(true); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); setShowSearch(true); }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveActive]);

  // Warn before closing/refreshing the browser tab with unsaved changes
  useEffect(() => {
    const anyDirty = tabs.some(t => t.dirty);
    if (!anyDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [tabs]);

  // Autosave — debounced save after the configured pause in typing
  useEffect(() => {
    if (!ideSettings.autosave || !activeTabData?.dirty) return;
    const timer = setTimeout(() => { saveActive(); }, ideSettings.autosaveIntervalMs);
    return () => clearTimeout(timer);
  }, [ideSettings.autosave, ideSettings.autosaveIntervalMs, activeTabData?.dirty, activeTabData?.content, saveActive]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--color-bg)" }}>
      <ToastHost />
      <DialogHost />

      {/* ── Top Header Bar ────────────────────────────────────────────── */}
      <div style={{
        height: 38, borderBottom: "1px solid var(--color-border)",
        background: "var(--color-surface)", display: "flex", alignItems: "center",
        padding: "0 12px", gap: 12, flexShrink: 0,
      }}>
        {/* Workspace Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Code2 size={15} style={{ color: "#6366f1" }} />
          <select
            value={currentProject}
            onChange={e => handleSelectProject(e.target.value)}
            style={{
              background: "var(--color-surface-raised)", border: "1px solid var(--color-border-hi)",
              borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600,
              color: "var(--color-text-primary)", outline: "none", cursor: "pointer",
            }}
          >
            {projects.map(p => (
              <option key={p.path} value={p.path}>
                Workspace: {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Server Status Badges — FastAPI is polled for real, Next.js is true by definition (you're seeing this) */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            title={backendUp ? "Backend responded within the last 5s" : "Backend did not respond — actions will fail"}
            style={{
              fontSize: 9, padding: "2px 6px", borderRadius: 4,
              background: backendUp ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              color: backendUp ? "#22c55e" : "#f87171",
              border: `1px solid ${backendUp ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.4)"}`,
            }}
          >
            ● FastAPI :8000 {backendUp ? "" : "(unreachable)"}
          </span>
          <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(99,102,241,0.15)", color: "#818cf8", border: "1px solid rgba(99,102,241,0.3)" }}>
            ● Next.js :3001
          </span>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {/* Save button */}
          {activeTabData?.dirty && (
            <button
              onClick={saveActive}
              disabled={saving}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
                borderRadius: 4, background: "#22c55e22", border: "1px solid #22c55e44",
                color: "#22c55e", fontSize: 11, cursor: "pointer", fontWeight: 600,
              }}
            >
              <Save size={12} />
              {saving ? "Saving…" : "Save"}
            </button>
          )}

          {/* Terminal Toggle Button */}
          <button
            onClick={() => setBottomOpen(b => !b)}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
              borderRadius: 4, background: bottomOpen ? "var(--color-surface-float)" : "var(--color-surface-raised)",
              border: "1px solid var(--color-border)", color: "var(--color-text-secondary)",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <Terminal size={12} />
            Terminal
          </button>

          {/* Panel Collapse Toggles */}
          <button
            onClick={() => explorerPanelRef.current?.isCollapsed() ? explorerPanelRef.current?.expand() : explorerPanelRef.current?.collapse()}
            title="Toggle explorer panel"
            style={{
              display: "flex", alignItems: "center", padding: "3px 8px",
              borderRadius: 4, background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)", color: "var(--color-text-secondary)",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <PanelLeftClose size={12} />
          </button>
          <button
            onClick={() => aiPanelRef.current?.isCollapsed() ? aiPanelRef.current?.expand() : aiPanelRef.current?.collapse()}
            title="Toggle AI panel"
            style={{
              display: "flex", alignItems: "center", padding: "3px 8px",
              borderRadius: 4, background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)", color: "var(--color-text-secondary)",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <PanelRightClose size={12} />
          </button>

          {/* Quick Open / Search Buttons */}
          <button
            onClick={() => setShowQuickOpen(true)}
            title="Go to file (Ctrl+P)"
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
              borderRadius: 4, background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)", color: "var(--color-text-secondary)",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <FileCode size={12} />
          </button>
          <button
            onClick={() => setShowSearch(true)}
            title="Search across files (Ctrl+Shift+F)"
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
              borderRadius: 4, background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)", color: "var(--color-text-secondary)",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <Search size={12} />
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            title="IDE settings — theme, font, autosave"
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "3px 8px",
              borderRadius: 4, background: "var(--color-surface-raised)",
              border: "1px solid var(--color-border)", color: "var(--color-text-secondary)",
              fontSize: 11, cursor: "pointer",
            }}
          >
            <SettingsIcon size={12} />
          </button>
        </div>
      </div>

      {showSettings && (
        <IdeSettingsModal
          settings={ideSettings}
          onSave={saveIdeSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showQuickOpen && <QuickOpenModal onOpenFile={openFile} onClose={() => setShowQuickOpen(false)} />}
      {showSearch && <GlobalSearchModal onOpenFile={openFile} onClose={() => setShowSearch(false)} />}

      {!backendUp && (
        <div style={{
          background: "rgba(239,68,68,0.15)", borderBottom: "1px solid rgba(239,68,68,0.4)",
          color: "#f87171", fontSize: 11, fontWeight: 600, padding: "5px 12px",
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        }}>
          <AlertCircle size={12} />
          Backend unreachable — file, git, terminal, and AI actions will fail until it reconnects.
        </div>
      )}

      {/* ── Main Middle Row (Left Explorer + Center Editor + Right AI Panel) + Bottom Panel ── */}
      <PanelGroup direction="vertical" style={{ flex: 1, minHeight: 0 }}>
        <Panel id="ide-main" order={1} defaultSize={78} minSize={40}>
      <PanelGroup direction="horizontal" style={{ height: "100%" }}>

        {/* Left: Explorer & Git */}
        <Panel id="ide-explorer" order={1} defaultSize={18} minSize={12} maxSize={35} collapsible collapsedSize={0} ref={explorerPanelRef}>
        <div style={{
          height: "100%", display: "flex", flexDirection: "column", background: "var(--color-surface)",
        }}>
          <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <FileTree onOpenFile={openFile} activeFilePath={activeTab} refreshKey={refreshTreeKey} />
          </div>
          <GitSystem onCommitSuccess={() => setRefreshTreeKey(k => k + 1)} />
        </div>
        </Panel>

        <ResizeHandle />

        {/* Center: Editor + Tab Bar */}
        <Panel id="ide-editor" order={2} defaultSize={57} minSize={30}>
        <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
          {/* Tab bar */}
          <div style={{
            display: "flex", alignItems: "center",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            overflowX: "auto", flexShrink: 0, minHeight: 34,
          }}>
            {tabs.length === 0 && (
              <span style={{ fontSize: 11, color: "#64748b", padding: "0 12px" }}>
                Select a file from the explorer to begin editing
              </span>
            )}
            {tabs.map((tab) => (
              <button
                key={tab.path}
                onClick={() => setActiveTab(tab.path)}
                title={tab.path}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "0 10px", height: 34,
                  background: activeTab === tab.path ? "var(--color-bg)" : "transparent",
                  border: "none",
                  borderRight: "1px solid var(--color-border)",
                  borderBottom: activeTab === tab.path ? "2px solid #6366f1" : "2px solid transparent",
                  cursor: "pointer", color: "var(--color-text)",
                  fontSize: 11, whiteSpace: "nowrap",
                }}
              >
                <FileIcon name={tab.label} size={12} />
                {tab.label}
                {tab.dirty && (
                  <Circle size={6} style={{ color: "#f59e0b", fill: "#f59e0b", flexShrink: 0 }} />
                )}
                <span
                  onClick={(e) => closeTab(tab.path, e)}
                  title="Close"
                  style={{
                    marginLeft: 2, cursor: "pointer", color: "#64748b",
                    display: "flex", alignItems: "center",
                    borderRadius: 2, padding: "0 1px",
                  }}
                >
                  <X size={11} />
                </span>
              </button>
            ))}
          </div>

          {/* Monaco Editor */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            {activeTabData ? (
              <Editor
                key={activeTabData.path}
                height="100%"
                language={activeTabData.language}
                value={activeTabData.content}
                theme={ideSettings.theme}
                onChange={handleChange}
                onMount={(editor) => { editorRef.current = editor; }}
                options={{
                  fontSize: ideSettings.fontSize,
                  fontFamily: ideSettings.fontFamily,
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
              <div style={{
                height: "100%", display: "flex", alignItems: "center",
                justifyContent: "center", flexDirection: "column", gap: 8,
              }}>
                <FileCode size={36} style={{ color: "#334155", opacity: 0.6 }} />
                <p style={{ color: "#475569", fontSize: 12 }}>Select a file to edit in Monaco Editor</p>
                <p style={{ color: "#334155", fontSize: 10 }}>Press Ctrl+S to save changes</p>
              </div>
            )}
          </div>
        </div>
        </Panel>

        <ResizeHandle />

        {/* Right: AI Agent Command Panel */}
        <Panel id="ide-ai" order={3} defaultSize={25} minSize={18} maxSize={40} collapsible collapsedSize={0} ref={aiPanelRef}>
        <AiAgentCommandPanel activeFilePath={activeTab} />
        </Panel>

      </PanelGroup>
        </Panel>

        {/* ── Collapsible Bottom Panel (Terminal / Output) ────────────────── */}
        {bottomOpen && (
          <>
          <ResizeHandle direction="horizontal" />
          <Panel id="ide-bottom" order={2} defaultSize={22} minSize={10} maxSize={60}>
        <div style={{
          height: "100%", borderTop: "1px solid var(--color-border)",
          background: "var(--color-surface)", display: "flex", flexDirection: "column",
        }}>
          <div style={{
            height: 28, borderBottom: "1px solid var(--color-border)",
            display: "flex", alignItems: "center", padding: "0 8px", gap: 8,
            background: "var(--color-surface-raised)", flexShrink: 0,
          }}>
            <button
              onClick={() => setBottomTab("terminal")}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 700, color: bottomTab === "terminal" ? "#6366f1" : "#64748b",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Terminal size={11} /> TERMINAL OUTPUT
            </button>
            <button
              onClick={() => setBottomTab("activity")}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 700, color: bottomTab === "activity" ? "#6366f1" : "#64748b",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Activity size={11} /> AGENT LOGS
            </button>
            <button
              onClick={() => setBottomTab("browser")}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 700, color: bottomTab === "browser" ? "#6366f1" : "#64748b",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Eye size={11} /> BROWSER
            </button>
            <button
              onClick={() => setBottomTab("problems")}
              style={{
                background: "none", border: "none", cursor: "pointer",
                fontSize: 10, fontWeight: 700, color: bottomTab === "problems" ? "#6366f1" : "#64748b",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <AlertCircle size={11} /> PROBLEMS
            </button>

            <button
              onClick={() => setBottomOpen(false)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#64748b" }}
            >
              <X size={12} />
            </button>
          </div>

          <div style={{ flex: 1, overflow: "hidden" }}>
            {bottomTab === "terminal" ? <TerminalDrawer />
              : bottomTab === "browser" ? <BrowserPreview />
              : bottomTab === "problems" ? <ProblemsPanel onOpenFile={openFile} />
              : <ActivityFeed />}
          </div>
        </div>
          </Panel>
          </>
        )}
      </PanelGroup>
    </div>
  );
}
