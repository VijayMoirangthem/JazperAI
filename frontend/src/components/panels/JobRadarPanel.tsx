"use client";

import { useState, useEffect, useCallback } from "react";
import { Radio, RefreshCw, ExternalLink, Bookmark, X, Loader2, Zap } from "lucide-react";

const API = "http://localhost:8000";

interface RadarHit {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  relevance: number;
  status: "new" | "saved" | "dismissed";
  matched_at: string | null;
}

type FilterTab = "new" | "saved" | "all";

function fmtAgo(ts: string | null): string {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function RelevanceBadge({ score }: { score: number }) {
  const pct  = Math.round(score * 100);
  const color = pct >= 80 ? "#22c55e" : pct >= 60 ? "#f59e0b" : "#6b7280";
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "1px 5px",
      borderRadius: "var(--r-full)",
      background: `color-mix(in srgb, ${color} 15%, transparent)`,
      color, border: `1px solid ${color}44`,
    }}>
      {pct}% match
    </span>
  );
}

export function JobRadarPanel() {
  const [hits, setHits]         = useState<RadarHit[]>([]);
  const [loading, setLoading]   = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [filter, setFilter]     = useState<FilterTab>("new");
  const [scanMsg, setScanMsg]   = useState<string | null>(null);

  const load = useCallback(async (statusFilter: FilterTab = filter) => {
    setLoading(true);
    setError(null);
    try {
      const param = statusFilter === "all" ? "all" : statusFilter;
      const res = await fetch(`${API}/api/jobs/radar?status=${param}&limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHits(data.hits || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load radar");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { load(filter); }, [load, filter]);

  async function updateStatus(id: string, status: "saved" | "dismissed") {
    setHits(prev => prev.map(h => h.id === id ? { ...h, status } : h));
    try {
      await fetch(`${API}/api/jobs/radar/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } catch { /* revert on failure */ load(filter); }
  }

  async function triggerScan() {
    setScanning(true);
    setScanMsg(null);
    try {
      const res = await fetch(`${API}/api/jobs/radar/scan`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setScanMsg(`Found ${data.new_hits ?? 0} new matches`);
        await load(filter);
      } else {
        setScanMsg(`Error: ${data.error || "scan failed"}`);
      }
    } catch (e) {
      setScanMsg(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
      setTimeout(() => setScanMsg(null), 5000);
    }
  }

  const visible = filter === "all"
    ? hits
    : hits.filter(h => h.status === filter);

  const TAB: FilterTab[] = ["new", "saved", "all"];

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Radio size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Job Market Radar</span>
        <span style={{
          marginLeft: "var(--sp-2)", fontSize: 9, fontWeight: 600,
          background: "color-mix(in srgb, #22c55e 12%, transparent)",
          color: "#22c55e", border: "1px solid #22c55e44",
          borderRadius: "var(--r-full)", padding: "1px 6px",
        }}>
          Daily Auto-Scan
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          {scanMsg && (
            <span style={{ fontSize: 10, color: scanMsg.startsWith("Error") ? "#ef4444" : "#22c55e" }}>
              {scanMsg}
            </span>
          )}
          <button
            onClick={triggerScan}
            disabled={scanning}
            title="Scan now"
            style={{
              display: "flex", alignItems: "center", gap: "var(--sp-1)",
              padding: "3px 8px", borderRadius: "var(--r-sm)",
              background: "var(--color-surface-raised)", border: "var(--border)",
              cursor: scanning ? "not-allowed" : "pointer", fontSize: 11,
              color: "var(--color-text-muted)", opacity: scanning ? 0.6 : 1,
            }}
          >
            {scanning ? <Loader2 size={10} className="sj-spin" /> : <Zap size={10} />}
            {scanning ? "Scanning…" : "Scan Now"}
          </button>
          <button
            onClick={() => load(filter)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
          >
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)",
        borderBottom: "var(--border)", flexShrink: 0,
      }}>
        {TAB.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            style={{
              padding: "4px 12px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
              border: "none", cursor: "pointer", textTransform: "capitalize",
              background: filter === t ? "var(--color-surface-raised)" : "none",
              color: filter === t ? "var(--color-text)" : "var(--color-text-muted)",
            }}
          >
            {t}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)", alignSelf: "center" }}>
          {visible.length} jobs
        </span>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : error ? (
          <div style={{ padding: "var(--sp-4)" }}>
            <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", marginBottom: "var(--sp-3)" }}>{error}</p>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center" }}>
              Click "Scan Now" to trigger the first radar scan.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "var(--sp-6)", textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>📡</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: "var(--sp-3)" }}>
              {filter === "new" ? "No new radar hits yet." : `No ${filter} jobs.`}
            </p>
            <p style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
              Click "Scan Now" or wait for the daily auto-scan (runs every 24h).
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {visible.map(hit => (
              <div
                key={hit.id}
                style={{
                  padding: "var(--sp-3)",
                  borderBottom: "1px solid var(--color-border-lo)",
                  opacity: hit.status === "dismissed" ? 0.4 : 1,
                  transition: "opacity 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-2)", marginBottom: 4 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}>
                        {hit.title}
                      </span>
                      <RelevanceBadge score={hit.relevance} />
                    </div>
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                      {hit.company}{hit.location ? ` · ${hit.location}` : ""}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0, marginTop: 2 }}>
                    {fmtAgo(hit.matched_at)}
                  </span>
                </div>

                <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
                  {hit.url && (
                    <a
                      href={hit.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "flex", alignItems: "center", gap: 3,
                        fontSize: 11, color: "var(--color-accent)",
                        textDecoration: "none",
                      }}
                    >
                      <ExternalLink size={10} /> View Job
                    </a>
                  )}
                  {hit.status !== "saved" && (
                    <button
                      onClick={() => updateStatus(hit.id, "saved")}
                      style={{
                        display: "flex", alignItems: "center", gap: 3,
                        fontSize: 11, padding: "2px 8px", borderRadius: "var(--r-sm)",
                        background: "color-mix(in srgb, #6366f1 12%, transparent)",
                        border: "1px solid #6366f144", color: "#6366f1", cursor: "pointer",
                      }}
                    >
                      <Bookmark size={9} /> Save
                    </button>
                  )}
                  {hit.status !== "dismissed" && (
                    <button
                      onClick={() => updateStatus(hit.id, "dismissed")}
                      style={{
                        display: "flex", alignItems: "center", gap: 3,
                        fontSize: 11, padding: "2px 8px", borderRadius: "var(--r-sm)",
                        background: "none", border: "1px solid var(--color-border)",
                        color: "var(--color-text-muted)", cursor: "pointer",
                      }}
                    >
                      <X size={9} /> Dismiss
                    </button>
                  )}
                  {hit.status === "saved" && (
                    <span style={{ fontSize: 10, color: "#22c55e", marginLeft: "auto" }}>✓ Saved</span>
                  )}
                </div>
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
