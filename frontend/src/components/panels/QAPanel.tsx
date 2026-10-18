"use client";

import { useState, useEffect, useCallback } from "react";
import { ShieldCheck, Play, RefreshCw, FlaskConical, Users, CheckCircle2, XCircle, AlertCircle, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface GateProbe { ok: boolean; passed: number; failed: number; errors?: number; failures?: string[]; duration_s?: number }
interface GatePulse { ok: boolean; checked: number; failed: number; skipped?: boolean }
interface SweepResult {
  ok: boolean;
  summary: string;
  probe: GateProbe;
  pulse: GatePulse;
}

interface AgentPerf {
  agent_id: string;
  latest_health: number;
  total_completed: number;
  total_failed: number;
  weeks: { week_start: string; tasks_completed: number; tasks_failed: number; health_score: number }[];
}

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";
  const label = score >= 80 ? "Healthy" : score >= 60 ? "Degraded" : "Critical";
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: "var(--r-full)",
      background: `${color}18`, border: `1px solid ${color}44`, color,
    }}>
      {label} {Math.round(score)}%
    </span>
  );
}

function GateRow({ label, result }: { label: string; result?: { ok: boolean; detail?: string } }) {
  if (!result) return null;
  const Icon = result.ok ? CheckCircle2 : XCircle;
  const color = result.ok ? "#22c55e" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "var(--sp-2) 0", borderBottom: "1px solid var(--color-border-lo)" }}>
      <Icon size={13} style={{ color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, color: "var(--color-text)", flex: 1 }}>{label}</span>
      {result.detail && (
        <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>{result.detail}</span>
      )}
    </div>
  );
}

export function QAPanel() {
  const toast = useToast();
  const [sweepRunning, setSweepRunning]   = useState(false);
  const [sweepResult, setSweepResult]     = useState<SweepResult | null>(null);
  const [sweepError, setSweepError]       = useState<string | null>(null);
  const [sweepOpen, setSweepOpen]         = useState(true);

  const [perf, setPerf]         = useState<AgentPerf[]>([]);
  const [perfLoading, setPerfLoading] = useState(true);

  const [genPath, setGenPath]   = useState("");
  const [genRunning, setGenRunning] = useState(false);
  const [genResult, setGenResult]   = useState<{ ok: boolean; test_path?: string; skipped?: boolean; error?: string } | null>(null);

  const loadPerf = useCallback(async () => {
    setPerfLoading(true);
    try {
      const res = await fetch(`${API}/api/it/performance?weeks=4`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPerf(data.agents || []);
    } catch { /* silent — table may be empty */ } finally {
      setPerfLoading(false);
    }
  }, []);

  useEffect(() => { loadPerf(); }, [loadPerf]);

  async function runSweep() {
    setSweepRunning(true);
    setSweepError(null);
    setSweepResult(null);
    toast("Aria QA sweep started — running Probe + Pulse…", "info");
    try {
      const res = await fetch(`${API}/api/it/qa-sweep`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setSweepResult(data.result);
      const approved = data.result.ok;
      toast(
        approved ? `Aria: APPROVED — ${data.result.summary}` : `Aria: BLOCKED — ${data.result.summary}`,
        approved ? "success" : "error"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Sweep failed";
      setSweepError(msg);
      toast(`QA sweep failed: ${msg}`, "error");
    } finally {
      setSweepRunning(false);
    }
  }

  async function generateTests() {
    if (!genPath.trim()) return;
    setGenRunning(true);
    setGenResult(null);
    toast(`Scribe generating tests for ${genPath}…`, "info");
    try {
      const res = await fetch(`${API}/api/it/generate-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_path: genPath }),
      });
      const data = await res.json();
      setGenResult(data);
      if (data.ok && !data.skipped) toast(`Tests written → ${data.test_path}`, "success");
      else if (data.skipped)        toast("Tests already exist — skipped.", "info");
      else                          toast(`Scribe failed: ${data.error}`, "error");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setGenResult({ ok: false, error: msg });
      toast(`Scribe error: ${msg}`, "error");
    } finally {
      setGenRunning(false);
    }
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <ShieldCheck size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">QA Command & Control</span>
        <button
          onClick={loadPerf}
          style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
        >
          <RefreshCw size={11} className={perfLoading ? "sj-spin" : undefined} />
        </button>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>

        {/* ── Aria Sweep ─────────────────────────────────────────────── */}
        <div className="sj-card">
          <div
            onClick={() => setSweepOpen(v => !v)}
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", cursor: "pointer", marginBottom: sweepOpen ? "var(--sp-3)" : 0 }}
          >
            {sweepOpen ? <ChevronDown size={12} style={{ color: "var(--color-icon)" }} /> : <ChevronRight size={12} style={{ color: "var(--color-icon)" }} />}
            <span className="sj-label" style={{ flex: 1 }}>Aria Sweep</span>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>Probe + Pulse · nightly 01:00 UTC</span>
          </div>

          {sweepOpen && (
            <>
              <button
                onClick={runSweep}
                disabled={sweepRunning}
                style={{
                  width: "100%", padding: "8px", borderRadius: "var(--r-sm)",
                  border: "none", cursor: sweepRunning ? "not-allowed" : "pointer",
                  background: sweepRunning ? "var(--color-surface-raised)" : "var(--color-accent)",
                  color: "#fff", fontSize: 12, fontWeight: 600,
                  display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-2)",
                  opacity: sweepRunning ? 0.7 : 1,
                  marginBottom: "var(--sp-3)",
                }}
              >
                {sweepRunning
                  ? <><Loader2 size={13} className="sj-spin" /> Running sweep…</>
                  : <><Play size={12} /> Run QA Sweep Now</>
                }
              </button>

              {sweepError && (
                <div style={{ display: "flex", gap: "var(--sp-2)", color: "#ef4444", fontSize: 12 }}>
                  <AlertCircle size={13} /> {sweepError}
                </div>
              )}

              {sweepResult && (
                <div>
                  {/* Overall verdict */}
                  <div style={{
                    padding: "var(--sp-2) var(--sp-3)", borderRadius: "var(--r-sm)", marginBottom: "var(--sp-3)",
                    background: sweepResult.ok ? "#14532d22" : "#7f1d1d22",
                    border: `1px solid ${sweepResult.ok ? "#22c55e44" : "#ef444444"}`,
                    display: "flex", alignItems: "center", gap: "var(--sp-2)",
                  }}>
                    {sweepResult.ok
                      ? <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
                      : <XCircle size={14} style={{ color: "#ef4444" }} />
                    }
                    <span style={{ fontSize: 12, fontWeight: 600, color: sweepResult.ok ? "#22c55e" : "#ef4444" }}>
                      {sweepResult.ok ? "APPROVED" : "BLOCKED"}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: "var(--sp-1)" }}>
                      {sweepResult.summary}
                    </span>
                  </div>

                  {/* Gate details */}
                  <GateRow
                    label="Gate 2 — Probe (pytest)"
                    result={{
                      ok: sweepResult.probe?.ok,
                      detail: sweepResult.probe
                        ? `${sweepResult.probe.passed} passed · ${sweepResult.probe.failed} failed${sweepResult.probe.duration_s ? ` · ${sweepResult.probe.duration_s.toFixed(1)}s` : ""}`
                        : undefined,
                    }}
                  />
                  <GateRow
                    label="Gate 3 — Pulse (endpoints)"
                    result={
                      sweepResult.pulse?.skipped
                        ? { ok: true, detail: "skipped" }
                        : { ok: sweepResult.pulse?.ok, detail: sweepResult.pulse ? `${sweepResult.pulse.checked - (sweepResult.pulse.failed || 0)}/${sweepResult.pulse.checked} healthy` : undefined }
                    }
                  />

                  {/* Failing tests */}
                  {sweepResult.probe?.failures && sweepResult.probe.failures.length > 0 && (
                    <div style={{ marginTop: "var(--sp-2)", padding: "var(--sp-2)", background: "var(--color-surface-raised)", borderRadius: "var(--r-sm)" }}>
                      <span className="sj-label" style={{ display: "block", marginBottom: "var(--sp-1)" }}>Failing tests</span>
                      {sweepResult.probe.failures.slice(0, 5).map((f, i) => (
                        <div key={i} style={{ fontSize: 10, color: "#ef4444", fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>{f}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!sweepResult && !sweepRunning && !sweepError && (
                <p style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center" }}>
                  Click to run a sweep. Aria runs automatically at 01:00 UTC.
                </p>
              )}
            </>
          )}
        </div>

        {/* ── Agent Performance ──────────────────────────────────────── */}
        <div className="sj-card">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
            <Users size={12} style={{ color: "var(--color-icon)" }} />
            <span className="sj-label">Agent Health — last 4 weeks</span>
          </div>

          {perfLoading ? (
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>Loading…</p>
          ) : perf.length === 0 ? (
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                No performance data yet — Warden runs weekly (Sunday 02:30 UTC).
              </p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {perf.sort((a, b) => a.latest_health - b.latest_health).map(a => (
                <div
                  key={a.agent_id}
                  style={{
                    display: "flex", alignItems: "center", gap: "var(--sp-2)",
                    padding: "var(--sp-2) var(--sp-2)", borderRadius: "var(--r-sm)",
                    background: "var(--color-surface-raised)",
                  }}
                >
                  <span style={{ fontSize: 12, color: "var(--color-text)", flex: 1, textTransform: "capitalize" }}>
                    {a.agent_id}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                    {a.total_completed}✓ {a.total_failed > 0 ? `${a.total_failed}✕` : ""}
                  </span>
                  <HealthBadge score={a.latest_health} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Scribe: Generate Tests ─────────────────────────────────── */}
        <div className="sj-card">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
            <FlaskConical size={12} style={{ color: "var(--color-icon)" }} />
            <span className="sj-label">Scribe — Generate Tests</span>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", marginLeft: "auto" }}>auto-runs when Forge creates a file</span>
          </div>

          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <input
              className="sj-input"
              placeholder="app/routes/tasks.py"
              value={genPath}
              onChange={e => setGenPath(e.target.value)}
              style={{ flex: 1, fontSize: 12, fontFamily: "var(--font-mono)" }}
              onKeyDown={e => { if (e.key === "Enter") generateTests(); }}
            />
            <button
              onClick={generateTests}
              disabled={genRunning || !genPath.trim()}
              style={{
                padding: "0 14px", borderRadius: "var(--r-sm)",
                background: "var(--color-accent)", border: "none", color: "#fff",
                cursor: genRunning || !genPath.trim() ? "not-allowed" : "pointer",
                opacity: genRunning || !genPath.trim() ? 0.5 : 1,
                fontSize: 11, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              {genRunning ? <Loader2 size={11} className="sj-spin" /> : <Play size={11} />}
              {genRunning ? "Running…" : "Generate"}
            </button>
          </div>

          {genResult && (
            <div style={{
              marginTop: "var(--sp-2)", padding: "var(--sp-2) var(--sp-3)", borderRadius: "var(--r-sm)",
              background: genResult.ok ? "#14532d22" : "#7f1d1d22",
              border: `1px solid ${genResult.ok ? "#22c55e44" : "#ef444444"}`,
              fontSize: 11,
            }}>
              {genResult.ok && !genResult.skipped && (
                <span style={{ color: "#22c55e" }}>✓ Tests written → <code style={{ fontFamily: "var(--font-mono)" }}>{genResult.test_path}</code></span>
              )}
              {genResult.skipped && (
                <span style={{ color: "#f59e0b" }}>⏭ Tests already exist at <code style={{ fontFamily: "var(--font-mono)" }}>{genResult.test_path}</code></span>
              )}
              {!genResult.ok && (
                <span style={{ color: "#ef4444" }}>✕ {genResult.error}</span>
              )}
            </div>
          )}

          <p style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: "var(--sp-2)", lineHeight: 1.5 }}>
            Scribe uses LLM to generate pytest tests for any backend file. Tests are saved to <code style={{ fontFamily: "var(--font-mono)", fontSize: 9 }}>backend/python/tests/</code>.
            Forge automatically triggers Scribe when it creates new files.
          </p>
        </div>

        <div style={{ height: "var(--sp-2)" }} />
      </div>
    </div>
  );
}
