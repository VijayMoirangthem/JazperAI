"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Server, Monitor, Terminal, Cpu, RefreshCw,
  Play, Square, RotateCcw, Circle, CheckCircle,
  XCircle, Clock, ChevronDown, ChevronRight,
  AlertTriangle, Zap, Globe, Network, Plus, Trash2,
  HeartPulse,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProcessInfo {
  name:      string;
  pid:       number | null;
  status:    "running" | "stopped" | "crashed" | "unknown";
  cpu_pct:   number;
  ram_mb:    number;
  uptime_s:  number | null;
  cmd:       string;
}

interface Resources {
  cpu_pct:       number;
  ram_used_gb:   number;
  ram_total_gb:  number;
  ram_pct:       number;
  disk_used_gb:  number;
  disk_total_gb: number;
  disk_pct:      number;
}

interface TerminalEntry {
  ts:          string;
  command:     string;
  risk:        string;
  caller:      string;
  reason?:     string;
  ok:          boolean;
  exit_code?:  number;
  duration_s?: number;
  output:      string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  safe:    "#22c55e",
  low:     "#60a5fa",
  medium:  "#f59e0b",
  high:    "#ef4444",
  blocked: "#7c3aed",
};

const PROC_COLORS: Record<string, string> = {
  backend:  "#6366f1",
  frontend: "#06b6d4",
  redis:    "#f59e0b",
  postgres: "#3b82f6",
  watchdog: "#94a3b8",
};

function fmtUptime(s: number | null): string {
  if (s === null) return "—";
  if (s < 60)   return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

function fmtAge(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{
      height: 4, borderRadius: 2,
      background: "rgba(255,255,255,0.08)",
      overflow: "hidden", width: "100%",
    }}>
      <div style={{
        height: "100%", width: `${Math.min(100, pct)}%`,
        background: color, borderRadius: 2,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

// ── Process card ──────────────────────────────────────────────────────────────

function ProcessCard({ proc }: { proc: ProcessInfo }) {
  const [expanded, setExpanded] = useState(false);
  const color = PROC_COLORS[proc.name] ?? "#64748b";
  const isUp  = proc.status === "running";

  return (
    <div style={{
      background: "var(--color-surface)",
      border: `1px solid ${isUp ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
      borderRadius: 6, padding: "10px 12px", marginBottom: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: isUp ? "#22c55e" : "#ef4444",
          boxShadow: isUp ? "0 0 6px #22c55e" : "none",
          flexShrink: 0,
        }} />
        <span style={{ fontSize: 13, fontWeight: 600, color, flex: 1 }}>
          {proc.name}
        </span>
        {proc.pid && (
          <span style={{ fontSize: 10, color: "#64748b" }}>PID {proc.pid}</span>
        )}
        <span style={{ fontSize: 10, color: isUp ? "#22c55e" : "#ef4444" }}>
          {proc.status}
        </span>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{ background: "none", border: "none", cursor: "pointer",
                   color: "#64748b", padding: 2 }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      </div>

      {isUp && (
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>
              CPU {proc.cpu_pct}%
            </div>
            <Bar pct={proc.cpu_pct} color={proc.cpu_pct > 80 ? "#ef4444" : color} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: "#64748b", marginBottom: 2 }}>
              RAM {proc.ram_mb < 1024
                ? `${proc.ram_mb}MB`
                : `${(proc.ram_mb / 1024).toFixed(1)}GB`}
            </div>
            <Bar pct={(proc.ram_mb / 2048) * 100} color={color} />
          </div>
          <div style={{ fontSize: 9, color: "#64748b", alignSelf: "flex-end" }}>
            ↑ {fmtUptime(proc.uptime_s)}
          </div>
        </div>
      )}

      {expanded && proc.cmd && (
        <div style={{
          marginTop: 8, fontSize: 10, fontFamily: "monospace",
          color: "#64748b", wordBreak: "break-all",
          background: "rgba(0,0,0,0.2)", padding: "4px 6px", borderRadius: 3,
        }}>
          {proc.cmd}
        </div>
      )}
    </div>
  );
}

// ── Resource bars ─────────────────────────────────────────────────────────────

function ResourceWidget({ res }: { res: Resources | null }) {
  if (!res) return (
    <p style={{ fontSize: 11, color: "#64748b", padding: 8 }}>Loading resources…</p>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 0" }}>
      {[
        { label: `CPU ${res.cpu_pct}%`,
          pct: res.cpu_pct,
          color: res.cpu_pct > 80 ? "#ef4444" : res.cpu_pct > 50 ? "#f59e0b" : "#22c55e" },
        { label: `RAM ${res.ram_used_gb}/${res.ram_total_gb}GB (${res.ram_pct}%)`,
          pct: res.ram_pct,
          color: res.ram_pct > 80 ? "#ef4444" : "#6366f1" },
        { label: `Disk ${res.disk_used_gb}/${res.disk_total_gb}GB (${res.disk_pct}%)`,
          pct: res.disk_pct,
          color: res.disk_pct > 90 ? "#ef4444" : "#06b6d4" },
      ].map(({ label, pct, color }) => (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between",
                        fontSize: 10, color: "#94a3b8", marginBottom: 3 }}>
            <span>{label}</span>
          </div>
          <Bar pct={pct} color={color} />
        </div>
      ))}
    </div>
  );
}

// ── Terminal entry ────────────────────────────────────────────────────────────

function TerminalEntry({ entry }: { entry: TerminalEntry }) {
  const [expanded, setExpanded] = useState(false);
  const riskColor = RISK_COLORS[entry.risk] ?? "#94a3b8";

  return (
    <div style={{
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      padding: "6px 0",
    }}>
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: "pointer", display: "flex", gap: 6, alignItems: "flex-start" }}
      >
        <span style={{ fontSize: 10, color: "#475569", flexShrink: 0, marginTop: 1 }}>
          {fmtAge(entry.ts)}
        </span>
        <span style={{
          fontSize: 9, fontWeight: 700, padding: "1px 4px",
          borderRadius: 3, background: `${riskColor}22`, color: riskColor,
          flexShrink: 0,
        }}>
          {entry.risk}
        </span>
        {entry.ok
          ? <CheckCircle size={11} style={{ color: "#22c55e", flexShrink: 0, marginTop: 1 }} />
          : <XCircle    size={11} style={{ color: "#ef4444", flexShrink: 0, marginTop: 1 }} />
        }
        <span style={{
          fontSize: 11, fontFamily: "monospace", color: "#e2e8f0",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1,
        }}>
          {entry.command}
        </span>
        {entry.duration_s !== undefined && (
          <span style={{ fontSize: 9, color: "#475569", flexShrink: 0 }}>
            {entry.duration_s}s
          </span>
        )}
      </div>

      {expanded && entry.output && (
        <pre style={{
          marginTop: 4, fontSize: 10, fontFamily: "monospace",
          color: "#94a3b8", background: "rgba(0,0,0,0.3)",
          padding: "6px 8px", borderRadius: 3, whiteSpace: "pre-wrap",
          wordBreak: "break-all", maxHeight: 200, overflowY: "auto",
        }}>
          {entry.output}
        </pre>
      )}
    </div>
  );
}

// ── Run command widget ────────────────────────────────────────────────────────

function RunWidget() {
  const [cmd, setCmd]       = useState("");
  const [cwd, setCwd]       = useState("backend/python");
  const [running, setRunning] = useState(false);
  const [result, setResult]  = useState<{ok: boolean; output: string} | null>(null);

  async function run() {
    if (!cmd.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/control-tower/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, cwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, output: data.detail ?? "Request failed" });
      } else {
        const out = (data.stdout || "") + (data.stderr ? `\n[stderr]\n${data.stderr}` : "");
        setResult({ ok: data.ok, output: out || "(no output)" });
      }
    } catch (e) {
      setResult({ ok: false, output: String(e) });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={e => e.key === "Enter" && run()}
          placeholder="Command (safe/low risk only)…"
          style={{
            flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-border)",
            borderRadius: 4, padding: "4px 8px", fontSize: 12,
            fontFamily: "monospace", color: "var(--color-text)",
          }}
        />
        <select
          value={cwd}
          onChange={e => setCwd(e.target.value)}
          style={{
            background: "rgba(255,255,255,0.06)", border: "1px solid var(--color-border)",
            borderRadius: 4, padding: "4px 6px", fontSize: 11, color: "var(--color-text)",
          }}
        >
          <option value=".">root</option>
          <option value="backend/python">backend</option>
          <option value="frontend">frontend</option>
        </select>
        <button
          onClick={run}
          disabled={running || !cmd.trim()}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            background: "#6366f1", border: "none", borderRadius: 4,
            padding: "4px 10px", fontSize: 12, color: "#fff",
            cursor: running ? "wait" : "pointer",
            opacity: running ? 0.6 : 1,
          }}
        >
          {running ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} /> : <Play size={12} />}
          {running ? "Running" : "Run"}
        </button>
      </div>
      {result && (
        <pre style={{
          fontSize: 10, fontFamily: "monospace", maxHeight: 200, overflowY: "auto",
          background: "rgba(0,0,0,0.3)", padding: "6px 8px", borderRadius: 3,
          color: result.ok ? "#94a3b8" : "#f87171", whiteSpace: "pre-wrap", wordBreak: "break-all",
        }}>
          {result.output}
        </pre>
      )}
    </div>
  );
}

// ── Voyager types ─────────────────────────────────────────────────────────────

interface ServiceEntry {
  id:           string;
  name:         string;
  path:         string;
  start_cmd:    string;
  stop_cmd:     string | null;
  health_url:   string | null;
  tags:         string[];
  status:       "unknown" | "running" | "stopped" | "error";
  added_at:     string;
  last_checked: string | null;
}

interface VoyagerPanelResult {
  panel:          string;
  ok:             boolean;
  screenshot_b64: string | null;
  console_errors: string[];
  duration_ms:    number;
  error:          string | null;
}

interface VoyagerRun {
  timestamp: string | null;
  panels:    VoyagerPanelResult[];
  summary:   { passed: number; failed: number; errors: string[] };
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "processes" | "terminal" | "resources" | "audit" | "browser" | "services";

const TABS: { id: Tab; label: string; Icon: typeof Server }[] = [
  { id: "processes", label: "Processes", Icon: Server },
  { id: "terminal",  label: "Terminal",  Icon: Terminal },
  { id: "resources", label: "Resources", Icon: Cpu },
  { id: "audit",     label: "Audit",     Icon: Zap },
  { id: "browser",   label: "Browser",   Icon: Globe },
  { id: "services",  label: "Services",  Icon: Network },
];

// ── Main ControlTowerPanel ────────────────────────────────────────────────────

export function ControlTowerPanel() {
  const [tab,        setTab]       = useState<Tab>("processes");
  const [processes,  setProcesses] = useState<ProcessInfo[]>([]);
  const [resources,  setResources] = useState<Resources | null>(null);
  const [termLog,    setTermLog]   = useState<TerminalEntry[]>([]);
  const [auditLog,   setAuditLog]  = useState<TerminalEntry[]>([]);
  const [loading,    setLoading]   = useState(false);
  const [voyagerRun,  setVoyagerRun]  = useState<VoyagerRun | null>(null);
  const [voyagerBusy, setVoyagerBusy] = useState(false);
  const [services,    setServices]    = useState<ServiceEntry[]>([]);
  const [svcBusy,     setSvcBusy]     = useState<Record<string, boolean>>({});
  const [addForm,     setAddForm]     = useState<{ open: boolean; name: string; start_cmd: string; path: string; stop_cmd: string; health_url: string }>({
    open: false, name: "", start_cmd: "", path: "", stop_cmd: "", health_url: "",
  });
  const termEndRef = useRef<HTMLDivElement>(null);

  // ── Fetch helpers ─────────────────────────────────────────────────────────
  const fetchProcesses = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/control-tower/processes`);
      if (r.ok) setProcesses((await r.json()).processes ?? []);
    } catch { /* backend offline */ }
  }, []);

  const fetchResources = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/control-tower/resources`);
      if (r.ok) setResources(await r.json());
    } catch { /* backend offline */ }
  }, []);

  const fetchTermLog = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/control-tower/terminal/log`);
      if (r.ok) setTermLog((await r.json()).entries ?? []);
    } catch { /* backend offline */ }
  }, []);

  const fetchAudit = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/control-tower/audit`);
      if (r.ok) setAuditLog((await r.json()).entries ?? []);
    } catch { /* backend offline */ }
  }, []);

  const fetchVoyager = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/voyager/last-run`);
      if (r.ok) setVoyagerRun(await r.json());
    } catch { /* backend offline */ }
  }, []);

  const fetchServices = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/services/`);
      if (r.ok) setServices((await r.json()).services ?? []);
    } catch { /* backend offline */ }
  }, []);

  async function addService() {
    const { name, start_cmd, path, stop_cmd, health_url } = addForm;
    if (!name.trim() || !start_cmd.trim()) return;
    try {
      const r = await fetch(`${API}/api/services/`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, start_cmd, path: path || undefined, stop_cmd: stop_cmd || undefined, health_url: health_url || undefined }),
      });
      if (r.ok) {
        setAddForm({ open: false, name: "", start_cmd: "", path: "", stop_cmd: "", health_url: "" });
        await fetchServices();
      }
    } catch { /* offline */ }
  }

  async function removeService(id: string) {
    setSvcBusy(b => ({ ...b, [id]: true }));
    try {
      await fetch(`${API}/api/services/${id}`, { method: "DELETE" });
      await fetchServices();
    } catch { /* offline */ }
    setSvcBusy(b => ({ ...b, [id]: false }));
  }

  async function startService(id: string) {
    setSvcBusy(b => ({ ...b, [id]: true }));
    try {
      await fetch(`${API}/api/services/${id}/start`, { method: "POST" });
      await fetchServices();
    } catch { /* offline */ }
    setSvcBusy(b => ({ ...b, [id]: false }));
  }

  async function stopService(id: string) {
    setSvcBusy(b => ({ ...b, [id]: true }));
    try {
      await fetch(`${API}/api/services/${id}/stop`, { method: "POST" });
      await fetchServices();
    } catch { /* offline */ }
    setSvcBusy(b => ({ ...b, [id]: false }));
  }

  async function checkHealth(id: string) {
    setSvcBusy(b => ({ ...b, [id]: true }));
    try {
      await fetch(`${API}/api/services/${id}/health`, { method: "POST" });
      await fetchServices();
    } catch { /* offline */ }
    setSvcBusy(b => ({ ...b, [id]: false }));
  }

  async function runGoldenPath() {
    setVoyagerBusy(true);
    try {
      const r = await fetch(`${API}/api/voyager/golden-path`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headless: true }),
      });
      if (r.ok) setVoyagerRun(await r.json());
    } catch { /* offline */ }
    setVoyagerBusy(false);
  }

  async function runSinglePanel(panel: string) {
    setVoyagerBusy(true);
    try {
      const r = await fetch(`${API}/api/voyager/test-panel`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ panel, headless: true }),
      });
      if (r.ok) {
        const result: VoyagerPanelResult = await r.json();
        setVoyagerRun(prev => prev ? {
          ...prev,
          panels: prev.panels.map(p => p.panel === panel ? result : p).concat(
            prev.panels.find(p => p.panel === panel) ? [] : [result]
          ),
          summary: { ...prev.summary,
            passed: prev.panels.filter(p => p.panel !== panel ? p.ok : result.ok).length,
          },
        } : { timestamp: new Date().toISOString(), panels: [result], summary: { passed: result.ok ? 1 : 0, failed: result.ok ? 0 : 1, errors: [] } });
      }
    } catch { /* offline */ }
    setVoyagerBusy(false);
  }

  // ── Initial + polling loads ───────────────────────────────────────────────
  useEffect(() => {
    fetchProcesses();
    fetchResources();
    fetchTermLog();
    const id1 = setInterval(fetchProcesses, 5_000);
    const id2 = setInterval(fetchResources, 3_000);
    const id3 = setInterval(fetchTermLog,   2_000);
    return () => { clearInterval(id1); clearInterval(id2); clearInterval(id3); };
  }, [fetchProcesses, fetchResources, fetchTermLog]);

  useEffect(() => {
    if (tab === "audit")    fetchAudit();
    if (tab === "browser")  fetchVoyager();
    if (tab === "services") fetchServices();
  }, [tab, fetchAudit, fetchVoyager, fetchServices]);

  // ── Terminal SSE stream ───────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== "terminal") return;
    const es = new EventSource(`${API}/api/control-tower/terminal/stream`);
    es.onmessage = (e) => {
      try {
        const entry = JSON.parse(e.data);
        if (entry.heartbeat) return;
        setTermLog(prev => [entry, ...prev].slice(0, 500));
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, [tab]);

  // ── Healthy/unhealthy count ───────────────────────────────────────────────
  const healthyCount = processes.filter(p => p.status === "running").length;
  const totalCount   = processes.length;

  return (
    <div className="sj-panel" style={{ height: "100%", overflow: "hidden",
                                       display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    marginBottom: 16, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Monitor size={16} style={{ color: "var(--color-accent)" }} />
          <h2 className="sj-heading" style={{ margin: 0 }}>Control Tower</h2>
          <span style={{
            fontSize: 10, padding: "2px 6px", borderRadius: 10,
            background: healthyCount === totalCount ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
            color: healthyCount === totalCount ? "#22c55e" : "#ef4444",
          }}>
            {healthyCount}/{totalCount} healthy
          </span>
        </div>
        <button
          onClick={() => { fetchProcesses(); fetchResources(); fetchTermLog(); }}
          style={{ background: "none", border: "none", cursor: "pointer",
                   color: "#64748b", display: "flex", alignItems: "center", gap: 4,
                   fontSize: 11 }}
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 1, marginBottom: 12, flexShrink: 0,
        background: "var(--color-border)", borderRadius: 6, padding: 2,
      }}>
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
              gap: 5, padding: "5px 8px", borderRadius: 4, border: "none",
              background: tab === id ? "var(--color-surface)" : "transparent",
              color: tab === id ? "var(--color-text)" : "#64748b",
              cursor: "pointer", fontSize: 11,
            }}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>

        {tab === "processes" && (
          <div>
            {processes.length === 0
              ? <p style={{ fontSize: 11, color: "#64748b" }}>No managed processes detected.</p>
              : processes.map(p => <ProcessCard key={p.name} proc={p} />)
            }
          </div>
        )}

        {tab === "terminal" && (
          <div>
            <RunWidget />
            <div style={{
              borderTop: "1px solid var(--color-border)",
              paddingTop: 8, marginTop: 4,
            }}>
              <p style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}>
                Recent commands (live)
              </p>
              {termLog.length === 0
                ? <p style={{ fontSize: 11, color: "#64748b" }}>
                    No commands run yet. Darwin runs pytest automatically during repairs.
                  </p>
                : termLog.map((e, i) => <TerminalEntry key={i} entry={e} />)
              }
            </div>
          </div>
        )}

        {tab === "resources" && (
          <div>
            <p style={{ fontSize: 10, color: "#475569", marginBottom: 8 }}>
              Host system resources (refreshes every 3s)
            </p>
            <ResourceWidget res={resources} />
          </div>
        )}

        {tab === "audit" && (
          <div>
            <p style={{ fontSize: 10, color: "#475569", marginBottom: 8 }}>
              Every command Commander has executed (risk-tiered, logged forever).
            </p>
            {auditLog.length === 0
              ? <p style={{ fontSize: 11, color: "#64748b" }}>No audit entries yet.</p>
              : auditLog.map((e, i) => <TerminalEntry key={i} entry={e} />)
            }
          </div>
        )}

        {tab === "browser" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <p style={{ fontSize: 10, color: "#475569", margin: 0, flex: 1 }}>
                Voyager autonomous browser agent — visual panel testing via Playwright.
              </p>
              <button
                onClick={runGoldenPath}
                disabled={voyagerBusy}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
                  color: "#818cf8", borderRadius: 5, padding: "5px 10px",
                  fontSize: 11, fontWeight: 700,
                  cursor: voyagerBusy ? "not-allowed" : "pointer",
                  opacity: voyagerBusy ? 0.5 : 1, flexShrink: 0,
                }}
              >
                <Globe size={12} />
                {voyagerBusy ? "Running…" : "Run Golden Path"}
              </button>
              <button
                onClick={fetchVoyager}
                style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, padding: "4px 6px", cursor: "pointer", color: "var(--color-text)" }}
              >
                <RefreshCw size={12} />
              </button>
            </div>

            {voyagerRun?.timestamp && (
              <p style={{ fontSize: 10, color: "#475569", marginBottom: 10 }}>
                Last run: {new Date(voyagerRun.timestamp).toLocaleTimeString()} ·{" "}
                <span style={{ color: "#22c55e" }}>{voyagerRun.summary.passed} passed</span>
                {voyagerRun.summary.failed > 0 && (
                  <span style={{ color: "#ef4444" }}> · {voyagerRun.summary.failed} failed</span>
                )}
              </p>
            )}

            {!voyagerRun?.panels?.length ? (
              <div style={{ textAlign: "center", padding: "40px 20px", opacity: 0.35 }}>
                <Globe size={28} style={{ margin: "0 auto 10px", display: "block" }} />
                <p style={{ fontSize: 12, margin: 0 }}>No runs yet</p>
                <p style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>
                  Click "Run Golden Path" or wait for Darwin to trigger Voyager after a repair.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {voyagerRun.panels.map((r) => (
                  <div key={r.panel} style={{
                    background: "var(--color-surface)", borderRadius: 7,
                    border: `1px solid ${r.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                    borderLeft: `3px solid ${r.ok ? "#22c55e" : "#ef4444"}`,
                    padding: "10px 12px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: r.screenshot_b64 ? 8 : 0 }}>
                      {r.ok
                        ? <CheckCircle size={13} style={{ color: "#22c55e", flexShrink: 0 }} />
                        : <XCircle    size={13} style={{ color: "#ef4444", flexShrink: 0 }} />}
                      <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{r.panel}</span>
                      <button
                        onClick={() => runSinglePanel(r.panel)}
                        disabled={voyagerBusy}
                        style={{
                          background: "none", border: "1px solid var(--color-border)",
                          borderRadius: 4, padding: "2px 7px", cursor: voyagerBusy ? "not-allowed" : "pointer",
                          color: "#64748b", fontSize: 10,
                        }}
                      >
                        Re-test
                      </button>
                      <span style={{ fontSize: 10, color: "#475569" }}>{r.duration_ms}ms</span>
                    </div>

                    {r.screenshot_b64 && (
                      <img
                        src={`data:image/png;base64,${r.screenshot_b64}`}
                        alt={`${r.panel} screenshot`}
                        style={{ width: "100%", borderRadius: 4, border: "1px solid var(--color-border)", display: "block" }}
                      />
                    )}

                    {r.console_errors.length > 0 && (
                      <div style={{ marginTop: 6 }}>
                        {r.console_errors.map((err, i) => (
                          <div key={i} style={{
                            fontSize: 10, color: "#f87171", fontFamily: "monospace",
                            background: "rgba(239,68,68,0.07)", borderRadius: 3,
                            padding: "3px 6px", marginTop: 3,
                          }}>
                            ✕ {err.slice(0, 200)}
                          </div>
                        ))}
                      </div>
                    )}
                    {r.error && (
                      <div style={{ fontSize: 10, color: "#f87171", marginTop: 4, fontFamily: "monospace" }}>
                        Error: {r.error.slice(0, 200)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "services" && (() => {
          const statusColor = (s: string) =>
            s === "running" ? "#22c55e" : s === "stopped" ? "#64748b" : s === "error" ? "#ef4444" : "#f59e0b";
          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <p style={{ fontSize: 10, color: "#475569", margin: 0, flex: 1 }}>
                  External services and projects COOS can start, stop, and health-check.
                </p>
                <button
                  onClick={() => setAddForm(f => ({ ...f, open: !f.open }))}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)",
                    color: "#818cf8", borderRadius: 5, padding: "5px 10px",
                    fontSize: 11, fontWeight: 700, cursor: "pointer", flexShrink: 0,
                  }}
                >
                  <Plus size={12} /> Add Service
                </button>
                <button
                  onClick={fetchServices}
                  style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 4, padding: "4px 6px", cursor: "pointer", color: "var(--color-text)" }}
                >
                  <RefreshCw size={12} />
                </button>
              </div>

              {addForm.open && (
                <div style={{
                  background: "var(--color-surface)", borderRadius: 7,
                  border: "1px solid rgba(99,102,241,0.25)", padding: "12px 14px", marginBottom: 12,
                }}>
                  <p style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, color: "#818cf8" }}>New Service</p>
                  {(["name", "start_cmd", "path", "stop_cmd", "health_url"] as const).map((field) => (
                    <div key={field} style={{ marginBottom: 6 }}>
                      <label style={{ fontSize: 10, color: "#64748b", display: "block", marginBottom: 2 }}>
                        {field === "name" ? "Name *" : field === "start_cmd" ? "Start command *" : field === "path" ? "Working directory" : field === "stop_cmd" ? "Stop command" : "Health URL"}
                      </label>
                      <input
                        value={addForm[field]}
                        onChange={e => setAddForm(f => ({ ...f, [field]: e.target.value }))}
                        placeholder={field === "name" ? "Portfolio API" : field === "start_cmd" ? "npm run dev" : field === "path" ? "C:\\Projects\\portfolio" : field === "stop_cmd" ? "leave blank to skip" : "http://localhost:4000/health"}
                        style={{
                          width: "100%", boxSizing: "border-box",
                          background: "#0f172a", border: "1px solid var(--color-border)",
                          borderRadius: 4, padding: "5px 8px", fontSize: 11,
                          color: "var(--color-text)", fontFamily: "monospace",
                        }}
                      />
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={addService}
                      disabled={!addForm.name.trim() || !addForm.start_cmd.trim()}
                      style={{
                        background: "rgba(99,102,241,0.2)", border: "1px solid rgba(99,102,241,0.35)",
                        color: "#818cf8", borderRadius: 5, padding: "5px 12px", fontSize: 11, fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Register
                    </button>
                    <button
                      onClick={() => setAddForm(f => ({ ...f, open: false }))}
                      style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 5, padding: "5px 12px", fontSize: 11, cursor: "pointer", color: "#64748b" }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {services.length === 0 ? (
                <div style={{ textAlign: "center", padding: "40px 20px", opacity: 0.35 }}>
                  <Network size={28} style={{ margin: "0 auto 10px", display: "block" }} />
                  <p style={{ fontSize: 12, margin: 0 }}>No services registered</p>
                  <p style={{ fontSize: 11, marginTop: 4, opacity: 0.7 }}>Add external projects you want COOS to manage.</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {services.map(svc => (
                    <div key={svc.id} style={{
                      background: "var(--color-surface)", borderRadius: 7,
                      border: "1px solid var(--color-border)",
                      borderLeft: `3px solid ${statusColor(svc.status)}`,
                      padding: "10px 12px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                        <Circle size={8} fill={statusColor(svc.status)} color={statusColor(svc.status)} style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{svc.name}</span>
                        <span style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>{svc.status}</span>
                      </div>

                      <div style={{ fontSize: 10, color: "#475569", fontFamily: "monospace", marginBottom: 6 }}>
                        $ {svc.start_cmd}
                        {svc.path && <span style={{ color: "#334155" }}> (in {svc.path})</span>}
                      </div>

                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          onClick={() => startService(svc.id)}
                          disabled={!!svcBusy[svc.id]}
                          style={{
                            display: "flex", alignItems: "center", gap: 4,
                            background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)",
                            color: "#22c55e", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer",
                            opacity: svcBusy[svc.id] ? 0.5 : 1,
                          }}
                        >
                          <Play size={9} /> Start
                        </button>
                        {svc.stop_cmd && (
                          <button
                            onClick={() => stopService(svc.id)}
                            disabled={!!svcBusy[svc.id]}
                            style={{
                              display: "flex", alignItems: "center", gap: 4,
                              background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
                              color: "#f87171", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer",
                              opacity: svcBusy[svc.id] ? 0.5 : 1,
                            }}
                          >
                            <Square size={9} /> Stop
                          </button>
                        )}
                        {svc.health_url && (
                          <button
                            onClick={() => checkHealth(svc.id)}
                            disabled={!!svcBusy[svc.id]}
                            style={{
                              display: "flex", alignItems: "center", gap: 4,
                              background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)",
                              color: "#818cf8", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer",
                              opacity: svcBusy[svc.id] ? 0.5 : 1,
                            }}
                          >
                            <HeartPulse size={9} /> Health
                          </button>
                        )}
                        <button
                          onClick={() => removeService(svc.id)}
                          disabled={!!svcBusy[svc.id]}
                          style={{
                            display: "flex", alignItems: "center", gap: 4,
                            background: "none", border: "1px solid var(--color-border)",
                            color: "#475569", borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer",
                            marginLeft: "auto",
                          }}
                        >
                          <Trash2 size={9} /> Remove
                        </button>
                      </div>

                      {svc.last_checked && (
                        <p style={{ fontSize: 9, color: "#334155", marginTop: 5, margin: "5px 0 0" }}>
                          Last checked {new Date(svc.last_checked).toLocaleTimeString()}
                          {svc.health_url && <span style={{ color: "#475569" }}> · {svc.health_url}</span>}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
