"use client";

import { Sun, Moon, Command, Cpu, Building2, LayoutDashboard, MonitorDot } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { useState, useEffect, useRef } from "react";

interface TopbarProps {
  title: string;
  onCommandCenter?: () => void;
  studioMode?: boolean;
  onStudioToggle?: () => void;
  rightSlot?: React.ReactNode;  // injected content rendered before the Studio toggle
}

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Context window sizes by model (tokens)
const MODEL_CONTEXT: Record<string, number> = {
  "llama-4-scout-17b-16e-instruct":  131072,
  "llama-3.3-70b-versatile":         131072,
  "llama-3.1-8b-instant":            131072,
  "gemini-2.0-flash":                1048576,
  "gemini-1.5-flash":                1048576,
  "qwen3-32b":                       131072,
  "default":                         131072,
};

function getContextLimit(modelId: string): number {
  for (const [key, val] of Object.entries(MODEL_CONTEXT)) {
    if (modelId.includes(key)) return val;
  }
  return MODEL_CONTEXT.default;
}

function fmtK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

interface AgentTokenStat { tokens: number; requests: number; }

interface SessionStats {
  totalPrompt: number;
  totalCompletion: number;
  totalTokens: number;
  requests: number;
  lastModel: string;
  lastDurationMs: number;
  avgDurationMs: number;
  perAgent: Record<string, AgentTokenStat>;
}

const AGENT_EMOJI: Record<string, string> = {
  Scout: "🔍", Hermes: "📧", Sage: "🧠", Lens: "📷", Atlas: "📋", Phantom: "👻",
};

export function Topbar({ title, onCommandCenter, studioMode, onStudioToggle, rightSlot }: TopbarProps) {
  const { theme, toggle } = useTheme();
  const [modelId,         setModelId]         = useState<string | null>(null);
  const [online,          setOnline]          = useState(false);
  const [stats,           setStats]           = useState<SessionStats | null>(null);
  const [usingLocalFallback, setUsingLocalFallback] = useState(false);
  const [tooltipVisible, setTooltipVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const durations = useRef<number[]>([]);

  // Fetch active model + provider status from backend
  useEffect(() => {
    async function fetchModel() {
      try {
        const res = await fetch(`${API}/api/models/`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        const first: string | undefined = data.models?.[0]?.id;
        setModelId(first ?? null);
        setOnline(true);
      } catch {
        setModelId(null);
        setOnline(false);
      }
    }
    async function fetchProviderStatus() {
      try {
        const res = await fetch(`${API}/api/models/provider-status`);
        if (!res.ok) return;
        const data = await res.json();
        setUsingLocalFallback(
          data.all_primary_exhausted === true && data.local_fallback_available === true
        );
      } catch { /* offline */ }
    }
    fetchModel();
    fetchProviderStatus();
    const id1 = setInterval(fetchModel, 15000);
    const id2 = setInterval(fetchProviderStatus, 10000);
    return () => { clearInterval(id1); clearInterval(id2); };
  }, []);

  // Listen for token events emitted by ChatPanel after each response
  useEffect(() => {
    function onTokens(e: Event) {
      const meta = (e as CustomEvent).detail as {
        model: string;
        duration_ms: number;
        tokens: { prompt: number; completion: number; total: number };
        agent_traces?: Array<{ agent: string; tokens_total: number; duration_ms: number }>;
      };
      durations.current.push(meta.duration_ms);
      const avg = Math.round(durations.current.reduce((a, b) => a + b, 0) / durations.current.length);

      setStats(prev => {
        const prevPerAgent = prev?.perAgent ?? {};
        const newPerAgent = { ...prevPerAgent };
        for (const t of meta.agent_traces ?? []) {
          const existing = newPerAgent[t.agent] ?? { tokens: 0, requests: 0 };
          newPerAgent[t.agent] = {
            tokens: existing.tokens + t.tokens_total,
            requests: existing.requests + 1,
          };
        }
        return {
          totalPrompt:     (prev?.totalPrompt     ?? 0) + meta.tokens.prompt,
          totalCompletion: (prev?.totalCompletion ?? 0) + meta.tokens.completion,
          totalTokens:     (prev?.totalTokens     ?? 0) + meta.tokens.total,
          requests:        (prev?.requests        ?? 0) + 1,
          lastModel:       meta.model,
          lastDurationMs:  meta.duration_ms,
          avgDurationMs:   avg,
          perAgent:        newPerAgent,
        };
      });
    }
    window.addEventListener("sj:tokens", onTokens);
    return () => window.removeEventListener("sj:tokens", onTokens);
  }, []);

  const contextLimit = getContextLimit(modelId ?? "default");
  const usedTokens   = stats?.totalTokens ?? 0;
  const usagePct     = Math.min(100, (usedTokens / contextLimit) * 100);
  const shortModel   = modelId ? (modelId.split("/").pop() ?? modelId) : null;

  const barColor = usagePct > 85 ? "#ef4444" : usagePct > 60 ? "#f59e0b" : "var(--color-accent)";

  return (
    <header className="sj-topbar">
      <span className="sj-dot sj-dot-live" />
      <span className="sj-subheading" style={{ fontSize: 12 }}>{title}</span>

      <div className="sj-ml-auto sj-flex sj-items-center sj-gap-3">

        {/* ── Token usage pill ─────────────────────────────────────── */}
        <div
          style={{ position: "relative" }}
          onMouseEnter={() => setTooltipVisible(true)}
          onMouseLeave={() => setTooltipVisible(false)}
        >
          <div style={{
            display: "flex", alignItems: "center", gap: 6, cursor: "default",
            padding: "3px 8px", borderRadius: "var(--r-md)",
            background: "var(--color-surface-raised)", border: "var(--border)",
            transition: "var(--ease-soft)",
          }}>
            <Cpu size={10} style={{ color: "var(--color-text-muted)" }} />
            <span className="sj-mono" style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
              {fmtK(usedTokens)}<span style={{ color: "var(--color-text-muted)" }}> / {fmtK(contextLimit)}</span>
            </span>
            {/* mini progress bar */}
            <div style={{ width: 40, height: 3, background: "var(--color-border)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${usagePct}%`, height: "100%", background: barColor, borderRadius: 99, transition: "width 0.4s ease" }} />
            </div>
          </div>

          {/* Tooltip */}
          {tooltipVisible && (
            <div ref={tooltipRef} style={{
              position: "absolute", top: "calc(100% + 8px)", right: 0, zIndex: 200,
              background: "var(--color-surface-raised)", border: "var(--border-hi)",
              borderRadius: "var(--r-md)", padding: "var(--sp-3)",
              minWidth: 220, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
              animation: "sj-fade-in 0.1s ease forwards",
              pointerEvents: "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
                <Cpu size={10} style={{ color: "var(--color-accent)" }} />
                <span className="sj-label">Session Token Usage</span>
              </div>

              {/* Progress bar */}
              <div style={{ width: "100%", height: 4, background: "var(--color-border)", borderRadius: 99, overflow: "hidden", marginBottom: "var(--sp-3)" }}>
                <div style={{ width: `${usagePct}%`, height: "100%", background: barColor, borderRadius: 99 }} />
              </div>

              {[
                { label: "Used",        value: usedTokens.toLocaleString() + " tokens", hi: true },
                { label: "Context limit", value: contextLimit.toLocaleString() + " tokens" },
                { label: "Remaining",   value: Math.max(0, contextLimit - usedTokens).toLocaleString() + " tokens" },
                { label: "Prompt",      value: (stats?.totalPrompt ?? 0).toLocaleString() },
                { label: "Completion",  value: (stats?.totalCompletion ?? 0).toLocaleString() },
                { label: "Requests",    value: String(stats?.requests ?? 0) },
                { label: "Avg speed",   value: stats ? `${stats.avgDurationMs < 1000 ? stats.avgDurationMs + "ms" : (stats.avgDurationMs / 1000).toFixed(1) + "s"}` : "—" },
                { label: "Model",       value: shortModel ?? "—" },
              ].map(({ label, value, hi }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "var(--border-lo)" }}>
                  <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{label}</span>
                  <span className="sj-mono" style={{ fontSize: 11, color: hi ? "var(--color-text-primary)" : "var(--color-text-secondary)", fontWeight: hi ? 500 : 400 }}>{value}</span>
                </div>
              ))}

              {/* Per-agent breakdown */}
              {stats?.perAgent && Object.keys(stats.perAgent).length > 0 && (
                <div style={{ marginTop: "var(--sp-2)", borderTop: "var(--border)", paddingTop: "var(--sp-2)" }}>
                  <div className="sj-micro" style={{ color: "var(--color-text-muted)", marginBottom: "var(--sp-1)" }}>BY AGENT</div>
                  {Object.entries(stats.perAgent)
                    .sort(([, a], [, b]) => b.tokens - a.tokens)
                    .map(([name, stat]) => (
                      <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                        <span className="sj-micro" style={{ color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 4 }}>
                          {AGENT_EMOJI[name] || "🤖"} {name}
                          <span style={{ opacity: 0.5 }}>×{stat.requests}</span>
                        </span>
                        <span className="sj-mono" style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
                          {stat.tokens.toLocaleString()}
                        </span>
                      </div>
                    ))
                  }
                </div>
              )}

              <p className="sj-micro" style={{ marginTop: "var(--sp-2)", opacity: 0.4 }}>Resets on page refresh</p>
            </div>
          )}
        </div>

        {/* ── Model name + fallback badge ──────────────────────────── */}
        {shortModel && (
          <div className="sj-flex sj-items-center sj-gap-1">
            <span className="sj-micro">AI</span>
            <span className="sj-badge sj-badge-hi">{shortModel}</span>
            {usingLocalFallback && (
              <span
                title="All Groq keys rate-limited — responses coming from local LM Studio model"
                style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em",
                  padding: "1px 5px", borderRadius: 4,
                  background: "rgba(245,158,11,0.15)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  color: "#f59e0b",
                }}
              >
                LOCAL
              </span>
            )}
          </div>
        )}

        {/* ── Backend status ───────────────────────────────────────── */}
        <div className="sj-flex sj-items-center sj-gap-1">
          <span className={`sj-dot ${online ? "sj-dot-settled" : "sj-dot-off"}`} />
          <span className="sj-micro">{online ? "Online" : "Offline"}</span>
        </div>

        {rightSlot}

        {onStudioToggle && (
          <button
            className="sj-theme-toggle"
            onClick={onStudioToggle}
            aria-label="Toggle Studio Mode"
            title="Studio Mode (Ctrl+Shift+S)"
            style={{
              display: "flex", alignItems: "center", gap: 4,
              background: studioMode ? "rgba(99,102,241,0.15)" : undefined,
              color: studioMode ? "#818cf8" : undefined,
              border: studioMode ? "1px solid rgba(99,102,241,0.3)" : undefined,
            }}
          >
            {studioMode ? <LayoutDashboard size={11}/> : <MonitorDot size={11}/>}
            {studioMode ? "Normal" : "Studio"}
          </button>
        )}

        {onCommandCenter && (
          <button
            className="sj-theme-toggle"
            onClick={onCommandCenter}
            aria-label="Command Center"
            style={{ display: "flex", alignItems: "center", gap: 4 }}
          >
            <Building2 size={11} />
            HQ
          </button>
        )}

        <button className="sj-theme-toggle" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun size={11} /> : <Moon size={11} />}
          {theme === "dark" ? "Light" : "Dark"}
        </button>

        <span className="sj-kbd" style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Command size={9} /> K
        </span>
      </div>
    </header>
  );
}
