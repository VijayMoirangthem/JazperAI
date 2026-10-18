"use client";

import { useState, useEffect, useCallback } from "react";
import { Mic, RefreshCw, Loader2, Copy, Sparkles } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface StandupEntry {
  id: string;
  content: string;
  generated_at: string;
}

interface GenerateResult {
  standup: string;
  generated_at: string;
  context_summary: {
    tasks_done: number;
    focus_minutes: number;
    upcoming_due: number;
  };
}

function fmtDate(ts: string) {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.round((now.getTime() - d.getTime()) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
  } catch { return ""; }
}

function StandupBody({ content }: { content: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
      {content.split("\n").filter(l => l.trim()).map((line, i) => {
        const isSection = line.match(/^[✅🎯⚠️]/);
        return (
          <p key={i} style={{
            margin: 0,
            fontSize: isSection ? 13 : 12,
            fontWeight: isSection ? 600 : 400,
            color: isSection ? "var(--color-text)" : "var(--color-text-muted)",
            lineHeight: 1.65,
            paddingLeft: isSection ? 0 : "var(--sp-3)",
          }}>
            {line}
          </p>
        );
      })}
    </div>
  );
}

export function StandupPanel() {
  const toast = useToast();

  const [history, setHistory]           = useState<StandupEntry[]>([]);
  const [current, setCurrent]           = useState<GenerateResult | null>(null);
  const [loading, setLoading]           = useState(true);
  const [generating, setGenerating]     = useState(false);
  const [activeId, setActiveId]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/standup/history?limit=7`);
      if (res.ok) {
        const data = await res.json();
        const list: StandupEntry[] = data.standups || [];
        setHistory(list);
        if (list.length > 0 && !activeId) setActiveId(list[0].id);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [activeId]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true);
    setCurrent(null);
    try {
      const res = await fetch(`${API}/api/standup/generate`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GenerateResult = await res.json();
      setCurrent(data);
      toast("Standup generated!", "success");
      load();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setGenerating(false); }
  }

  function copyStandup(content: string) {
    navigator.clipboard.writeText(content).then(() => toast("Copied to clipboard!", "success"));
  }

  const displayContent = current?.standup || (activeId ? history.find(h => h.id === activeId)?.content : null);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Mic size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Daily Standup</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
          <button
            onClick={generate}
            disabled={generating}
            style={{
              padding: "3px 12px", borderRadius: "var(--r-sm)", border: "none",
              background: generating ? "var(--color-surface-raised)" : "var(--color-accent)",
              color: "#fff", fontSize: 11, fontWeight: 600,
              cursor: generating ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 4,
            }}
          >
            {generating ? <><Loader2 size={11} className="sj-spin" /> Generating…</> : <><Sparkles size={11} /> Generate Today&apos;s</>}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
        {/* History sidebar */}
        {history.length > 0 && (
          <div style={{ width: 140, borderRight: "var(--border)", overflowY: "auto", flexShrink: 0 }}>
            {current && (
              <div
                onClick={() => { setActiveId(null); }}
                style={{ padding: "var(--sp-2) var(--sp-3)", cursor: "pointer", borderBottom: "1px solid var(--color-border-lo)", background: !activeId ? "var(--color-surface-raised)" : "transparent" }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-accent)" }}>Just Generated</div>
                <div style={{ fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>Today</div>
              </div>
            )}
            {history.map(h => (
              <div
                key={h.id}
                onClick={() => { setActiveId(h.id); setCurrent(null); }}
                style={{ padding: "var(--sp-2) var(--sp-3)", cursor: "pointer", borderBottom: "1px solid var(--color-border-lo)", background: activeId === h.id && !current ? "var(--color-surface-raised)" : "transparent" }}
              >
                <div style={{ fontSize: 11, fontWeight: activeId === h.id ? 600 : 400, color: "var(--color-text)" }}>{fmtDate(h.generated_at)}</div>
                <div style={{ fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                  {new Date(h.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main content */}
        <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
          {loading && !displayContent ? (
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
          ) : !displayContent ? (
            <div style={{ textAlign: "center", padding: "var(--sp-6)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-3)" }}>
              <div style={{ fontSize: 40 }}>🎤</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>No standup yet</p>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", maxWidth: 300 }}>
                Click Generate to create today&apos;s standup based on your completed tasks, focus sessions, and upcoming deadlines.
              </p>
              <button onClick={generate} disabled={generating} style={{ padding: "10px 24px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                {generating ? <><Loader2 size={14} className="sj-spin" /> Generating…</> : <><Sparkles size={14} /> Generate Today&apos;s Standup</>}
              </button>
            </div>
          ) : (
            <div style={{ padding: "var(--sp-4)", maxWidth: 560 }}>
              {/* Context summary */}
              {current?.context_summary && (
                <div style={{ display: "flex", gap: "var(--sp-3)", marginBottom: "var(--sp-3)", padding: "var(--sp-2)", background: "var(--color-surface-raised)", borderRadius: "var(--r-sm)", flexWrap: "wrap" }}>
                  {[
                    { label: "Tasks done", value: current.context_summary.tasks_done },
                    { label: "Focus time", value: current.context_summary.focus_minutes > 0 ? `${current.context_summary.focus_minutes}m` : "0" },
                    { label: "Due soon", value: current.context_summary.upcoming_due },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: "center", flex: 1 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>{s.value}</div>
                      <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase" }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-3)" }}>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0, fontFamily: "var(--font-mono)" }}>
                  {fmtDate(current?.generated_at || history.find(h => h.id === activeId)?.generated_at || "")}
                </p>
                <button
                  onClick={() => copyStandup(displayContent)}
                  style={{ padding: "4px 10px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 11, cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 4 }}
                >
                  <Copy size={10} /> Copy
                </button>
              </div>

              <div style={{ padding: "var(--sp-4)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", border: "var(--border)" }}>
                <StandupBody content={displayContent} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
