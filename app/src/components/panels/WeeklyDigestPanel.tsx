"use client";

import { useState, useEffect, useCallback } from "react";
import { Newspaper, RefreshCw, Sparkles, Loader2 } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface Digest {
  id: string;
  content: string;
  week_start: string;
  generated_at: string;
}

function fmtDate(ts: string) {
  try { return new Date(ts).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
  catch { return ts; }
}

function DigestBody({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {lines.map((line, i) => {
        const isH = line.match(/^##?\s/) || line.match(/^[🏆📊🎯⚡✅🔥]/);
        const isEmpty = line.trim() === "";
        if (isEmpty) return <div key={i} style={{ height: "var(--sp-2)" }} />;
        return (
          <p key={i} style={{
            margin: 0,
            fontSize: isH ? 13 : 12,
            fontWeight: isH ? 700 : 400,
            color: isH ? "var(--color-text)" : "var(--color-text-muted)",
            lineHeight: 1.65,
          }}>
            {line.replace(/^#+\s/, "")}
          </p>
        );
      })}
    </div>
  );
}

export function WeeklyDigestPanel() {
  const toast = useToast();

  const [digests, setDigests]       = useState<Digest[]>([]);
  const [loading, setLoading]       = useState(true);
  const [generating, setGenerating] = useState(false);
  const [active, setActive]         = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/digest`);
      if (res.ok) {
        const data = await res.json();
        const list: Digest[] = data.digests || [];
        setDigests(list);
        if (list.length > 0 && !active) setActive(list[0].id);
      }
    } catch { /* silent */ } finally { setLoading(false); }
  }, [active]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/digest/generate`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      toast("Weekly digest generated and sent to Telegram!", "success");
      await load();
      if (data.id) setActive(data.id);
      else {
        // load will set active to latest
        setActive(null);
      }
    } catch (e) {
      toast(`Generation failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setGenerating(false); }
  }

  const activeDigest = digests.find(d => d.id === active) || digests[0] || null;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Newspaper size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Weekly Digest</span>
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
            {generating ? <><Loader2 size={11} className="sj-spin" /> Generating…</> : <><Sparkles size={11} /> Generate Now</>}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0 }}>
        {/* Digest list sidebar */}
        {digests.length > 1 && (
          <div style={{ width: 160, borderRight: "var(--border)", overflowY: "auto", flexShrink: 0 }}>
            {digests.map(d => (
              <div
                key={d.id}
                onClick={() => setActive(d.id)}
                style={{
                  padding: "var(--sp-2) var(--sp-3)", cursor: "pointer",
                  borderBottom: "1px solid var(--color-border-lo)",
                  background: active === d.id ? "var(--color-surface-raised)" : "transparent",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: active === d.id ? 600 : 400, color: "var(--color-text)" }}>
                  Week of {fmtDate(d.week_start)}
                </div>
                <div style={{ fontSize: 9, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                  {fmtDate(d.generated_at)}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main content */}
        <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
          ) : !activeDigest ? (
            <div style={{ textAlign: "center", padding: "var(--sp-6)", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--sp-3)" }}>
              <div style={{ fontSize: 40 }}>📰</div>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>No digests yet</p>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)", maxWidth: 320 }}>
                Generate your first weekly digest. It summarizes your week — tasks, focus sessions, habits, applications — and sends it to Telegram.
              </p>
              <button
                onClick={generate}
                disabled={generating}
                style={{ padding: "10px 24px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "var(--sp-2)" }}
              >
                {generating ? <><Loader2 size={14} className="sj-spin" /> Generating…</> : <><Sparkles size={14} /> Generate My Weekly Digest</>}
              </button>
            </div>
          ) : (
            <div style={{ padding: "var(--sp-4)", maxWidth: 640 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-4)" }}>
                <div>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>
                    Week of {fmtDate(activeDigest.week_start)}
                  </p>
                  <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "var(--sp-1) 0 0", fontFamily: "var(--font-mono)" }}>
                    Generated {fmtDate(activeDigest.generated_at)}
                  </p>
                </div>
                <Sparkles size={16} style={{ color: "var(--color-accent)", opacity: 0.5 }} />
              </div>

              <div style={{ padding: "var(--sp-4)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", border: "var(--border)" }}>
                <DigestBody content={activeDigest.content} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
