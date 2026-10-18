"use client";

import { useState } from "react";
import { TrendingUp, Loader2, Copy, Send } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface CoachResult {
  talking_points: string[];
  counter_offer_script: string;
  floor_salary: number;
  confidence_level: "high" | "medium" | "low";
  gap_analysis: string;
}

const CONF_META = {
  high:   { label: "High confidence",   color: "#22c55e" },
  medium: { label: "Medium confidence", color: "#f59e0b" },
  low:    { label: "Low confidence",    color: "#ef4444" },
};

function fmt$(n: number) { return `$${n.toLocaleString()}`; }

export function SalaryCoachPanel() {
  const toast = useToast();

  const [offeredSalary, setOfferedSalary]   = useState("");
  const [targetSalary, setTargetSalary]     = useState("");
  const [company, setCompany]               = useState("");
  const [role, setRole]                     = useState("");
  const [experience, setExperience]         = useState("");
  const [marketData, setMarketData]         = useState("");
  const [analyzing, setAnalyzing]           = useState(false);
  const [result, setResult]                 = useState<CoachResult | null>(null);

  async function analyze() {
    if (!offeredSalary || !targetSalary || !company || !role) {
      toast("Fill in salary figures, company, and role", "warning"); return;
    }
    setAnalyzing(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/salary-coach/analyze`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offered_salary: Number(offeredSalary),
          target_salary: Number(targetSalary),
          company, role,
          experience_years: experience ? Number(experience) : undefined,
          market_data: marketData || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setResult(await res.json());
    } catch (e) {
      toast(`Analysis failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setAnalyzing(false); }
  }

  function copyScript() {
    if (!result?.counter_offer_script) return;
    navigator.clipboard.writeText(result.counter_offer_script).then(() => toast("Script copied!", "success"));
  }

  function sendViaCompose() {
    if (!result?.counter_offer_script) return;
    localStorage.setItem("sj_compose_prefill", JSON.stringify({
      subject: `Re: ${role} Offer — Salary Discussion`,
      body: result.counter_offer_script,
    }));
    window.location.hash = "compose";
    toast("Counter-offer loaded in composer", "info");
  }

  const gap = result ? ((Number(targetSalary) - Number(offeredSalary)) / Number(offeredSalary) * 100).toFixed(1) : null;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <TrendingUp size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Salary Coach</span>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: result ? "340px 1fr" : "1fr", gap: 0, height: "100%", minHeight: 0 }}>

          {/* Input form */}
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)", borderRight: result ? "var(--border)" : "none", overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
              <div>
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>Offered Salary ($)</span>
                <input className="sj-input" type="number" placeholder="95000" value={offeredSalary} onChange={e => setOfferedSalary(e.target.value)} style={{ fontSize: 12 }} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>Target Salary ($)</span>
                <input className="sj-input" type="number" placeholder="110000" value={targetSalary} onChange={e => setTargetSalary(e.target.value)} style={{ fontSize: 12 }} />
              </div>
            </div>
            <input className="sj-input" placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} style={{ fontSize: 12 }} />
            <input className="sj-input" placeholder="Role / Title" value={role} onChange={e => setRole(e.target.value)} style={{ fontSize: 12 }} />
            <input className="sj-input" type="number" placeholder="Years of experience" value={experience} onChange={e => setExperience(e.target.value)} style={{ fontSize: 12 }} />
            <textarea
              className="sj-input"
              placeholder="Market data  (optional — e.g. 'Glassdoor shows $105-115k for this role in Seattle')"
              value={marketData}
              onChange={e => setMarketData(e.target.value)}
              rows={3}
              style={{ fontSize: 12, resize: "vertical" }}
            />

            {offeredSalary && targetSalary && (
              <div style={{ display: "flex", gap: "var(--sp-3)", padding: "var(--sp-2)", background: "var(--color-surface-raised)", borderRadius: "var(--r-sm)" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>{fmt$(Number(offeredSalary))}</div>
                  <div style={{ fontSize: 9, color: "var(--color-text-muted)" }}>Offered</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-accent)" }}>{fmt$(Number(targetSalary))}</div>
                  <div style={{ fontSize: 9, color: "var(--color-text-muted)" }}>Target</div>
                </div>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "var(--font-mono)", color: "#22c55e" }}>+{gap}%</div>
                  <div style={{ fontSize: 9, color: "var(--color-text-muted)" }}>Gap</div>
                </div>
              </div>
            )}

            <button
              onClick={analyze}
              disabled={analyzing || !offeredSalary || !targetSalary || !company || !role}
              style={{ padding: "10px", borderRadius: "var(--r-sm)", border: "none", background: analyzing || !offeredSalary || !company ? "var(--color-surface-raised)" : "var(--color-accent)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-2)", opacity: !offeredSalary || !company ? 0.5 : 1 }}
            >
              {analyzing ? <><Loader2 size={13} className="sj-spin" /> Coaching…</> : <><TrendingUp size={13} /> Get Negotiation Coach</>}
            </button>
          </div>

          {/* Results */}
          {result && (
            <div style={{ padding: "var(--sp-4)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
              {/* Confidence + floor */}
              <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                <div className="sj-metric-card" style={{ flex: 1 }}>
                  <span className="sj-label" style={{ fontSize: 9 }}>Confidence</span>
                  <div style={{ fontSize: 13, fontWeight: 700, color: CONF_META[result.confidence_level]?.color || "var(--color-text)", marginTop: "var(--sp-1)" }}>
                    {CONF_META[result.confidence_level]?.label || result.confidence_level}
                  </div>
                </div>
                <div className="sj-metric-card" style={{ flex: 1 }}>
                  <span className="sj-label" style={{ fontSize: 9 }}>Minimum Floor</span>
                  <div style={{ fontSize: 13, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-text)", marginTop: "var(--sp-1)" }}>
                    {fmt$(result.floor_salary)}
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6, margin: 0, fontStyle: "italic" }}>{result.gap_analysis}</p>

              {/* Talking points */}
              <div>
                <p className="sj-label" style={{ marginBottom: "var(--sp-2)" }}>Talking Points</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                  {result.talking_points.map((pt, i) => (
                    <div key={i} style={{ display: "flex", gap: "var(--sp-2)", padding: "var(--sp-2)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", alignItems: "flex-start" }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--color-accent)", flexShrink: 0, fontFamily: "var(--font-mono)" }}>{i + 1}</span>
                      <p style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.6, margin: 0 }}>{pt}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Counter-offer script */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--sp-2)" }}>
                  <p className="sj-label">Counter-Offer Email Script</p>
                  <div style={{ display: "flex", gap: "var(--sp-1)" }}>
                    <button onClick={copyScript} style={{ padding: "3px 8px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 10, cursor: "pointer", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                      <Copy size={9} /> Copy
                    </button>
                    <button onClick={sendViaCompose} style={{ padding: "3px 8px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                      <Send size={9} /> Use in Composer
                    </button>
                  </div>
                </div>
                <div style={{ padding: "var(--sp-3)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", border: "var(--border)" }}>
                  <pre style={{ fontSize: 11, color: "var(--color-text)", whiteSpace: "pre-wrap", lineHeight: 1.7, margin: 0, fontFamily: "inherit" }}>
                    {result.counter_offer_script}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
