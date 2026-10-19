"use client";

import { useState, useEffect, useCallback } from "react";
import { DollarSign, Plus, Trash2, RefreshCw, Loader2, Star } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface OfferEval {
  id: string;
  company: string;
  role: string;
  base_salary: number;
  equity: string;
  pto_days: number;
  remote_type: string;
  bonus: number;
  other_perks: string;
  score: number;
  analysis: string;
  pros: string[];
  cons: string[];
  created_at: string;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 7.5 ? "#22c55e" : score >= 5 ? "#f59e0b" : "#ef4444";
  const R = 28, C = 2 * Math.PI * R;
  const dash = C * (score / 10);
  return (
    <div style={{ position: "relative", width: 72, height: 72, flexShrink: 0 }}>
      <svg width={72} height={72} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={36} cy={36} r={R} fill="none" stroke="var(--color-surface-raised)" strokeWidth={6} />
        <circle cx={36} cy={36} r={R} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C - dash} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "var(--font-mono)", color, lineHeight: 1 }}>{score.toFixed(1)}</span>
        <span style={{ fontSize: 8, color: "var(--color-text-muted)", textTransform: "uppercase" }}>/10</span>
      </div>
    </div>
  );
}

function fmt$(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;
}

export function OfferEvalPanel() {
  const toast = useToast();

  const [evals, setEvals]           = useState<OfferEval[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"list" | "new" | "compare">("list");
  const [evaluating, setEvaluating] = useState(false);

  // Form
  const [company, setCompany]       = useState("");
  const [role, setRole]             = useState("");
  const [salary, setSalary]         = useState("");
  const [equity, setEquity]         = useState("");
  const [pto, setPto]               = useState("15");
  const [remote, setRemote]         = useState("hybrid");
  const [bonus, setBonus]           = useState("0");
  const [perks, setPerks]           = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/offer-eval`);
      if (res.ok) setEvals((await res.json()).evaluations || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function evaluate() {
    if (!company.trim() || !role.trim() || !salary) { toast("Company, role, and salary are required", "warning"); return; }
    setEvaluating(true);
    try {
      const res = await fetch(`${API}/api/offer-eval`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, role, base_salary: Number(salary), equity, pto_days: Number(pto), remote_type: remote, bonus: Number(bonus), other_perks: perks }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast("Offer evaluated!", "success");
      setCompany(""); setRole(""); setSalary(""); setEquity(""); setPerks("");
      await load();
      setTab("list");
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setEvaluating(false); }
  }

  async function deleteEval(id: string) {
    setEvals(prev => prev.filter(e => e.id !== id));
    try { await fetch(`${API}/api/offer-eval/${id}`, { method: "DELETE" }); }
    catch { load(); }
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <DollarSign size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Offer Evaluator</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 2, alignItems: "center" }}>
          {(["list", "new", ...(evals.length >= 2 ? ["compare"] : [])] as const).map(t => (
            <button key={t} onClick={() => setTab(t as typeof tab)} style={{
              padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", cursor: "pointer", fontSize: 11,
              background: tab === t ? "var(--color-surface-raised)" : "none",
              color: tab === t ? "var(--color-text)" : "var(--color-text-muted)",
            }}>
              {t === "list" ? "Evaluations" : t === "new" ? "+ New" : "Compare"}
            </button>
          ))}
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
        </div>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>

        {/* ── NEW ──────────────────────────────────────────────────── */}
        {tab === "new" && (
          <div style={{ padding: "var(--sp-4)", display: "flex", flexDirection: "column", gap: "var(--sp-3)", maxWidth: 480, margin: "0 auto" }}>
            <input className="sj-input" placeholder="Company" value={company} onChange={e => setCompany(e.target.value)} style={{ fontSize: 13 }} />
            <input className="sj-input" placeholder="Role / Job Title" value={role} onChange={e => setRole(e.target.value)} style={{ fontSize: 13 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
              <div>
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>Base Salary ($)</span>
                <input className="sj-input" type="number" placeholder="95000" value={salary} onChange={e => setSalary(e.target.value)} style={{ fontSize: 12 }} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>Bonus ($)</span>
                <input className="sj-input" type="number" placeholder="0" value={bonus} onChange={e => setBonus(e.target.value)} style={{ fontSize: 12 }} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>PTO (days)</span>
                <input className="sj-input" type="number" placeholder="15" value={pto} onChange={e => setPto(e.target.value)} style={{ fontSize: 12 }} />
              </div>
              <div>
                <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 3 }}>Remote</span>
                <select className="sj-input" value={remote} onChange={e => setRemote(e.target.value)} style={{ fontSize: 12 }}>
                  <option value="remote">Full Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                </select>
              </div>
            </div>
            <input className="sj-input" placeholder="Equity (e.g. 0.1% over 4yr)" value={equity} onChange={e => setEquity(e.target.value)} style={{ fontSize: 12 }} />
            <textarea className="sj-input" placeholder="Other perks (health, 401k match, etc.)" value={perks} onChange={e => setPerks(e.target.value)} rows={2} style={{ fontSize: 12, resize: "vertical" }} />
            <button
              onClick={evaluate}
              disabled={evaluating || !company.trim() || !role.trim() || !salary}
              style={{ padding: "10px", borderRadius: "var(--r-sm)", border: "none", background: evaluating || !company.trim() || !salary ? "var(--color-surface-raised)" : "var(--color-accent)", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--sp-2)", opacity: !company.trim() || !salary ? 0.5 : 1 }}
            >
              {evaluating ? <><Loader2 size={14} className="sj-spin" /> Evaluating…</> : <><Star size={14} /> Evaluate Offer</>}
            </button>
          </div>
        )}

        {/* ── LIST ──────────────────────────────────────────────────── */}
        {tab === "list" && (
          loading ? (
            <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
          ) : evals.length === 0 ? (
            <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
              <div style={{ fontSize: 40, marginBottom: "var(--sp-3)" }}>💼</div>
              <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No offers evaluated yet. Click + New to add your first offer.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {evals.map(ev => (
                <div key={ev.id} className="sj-card" style={{ margin: "var(--sp-3)", marginBottom: 0 }}>
                  <div style={{ display: "flex", gap: "var(--sp-3)", alignItems: "flex-start" }}>
                    <ScoreRing score={ev.score} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                        <div>
                          <p style={{ fontSize: 14, fontWeight: 700, color: "var(--color-text)", margin: 0 }}>{ev.company}</p>
                          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "2px 0 var(--sp-1)" }}>{ev.role}</p>
                        </div>
                        <button onClick={() => deleteEval(ev.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)" }}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: "var(--sp-3)", flexWrap: "wrap", fontSize: 11, color: "var(--color-text-muted)", marginBottom: "var(--sp-2)" }}>
                        <span>💰 {fmt$(ev.base_salary)}</span>
                        {ev.bonus > 0 && <span>🎯 +{fmt$(ev.bonus)} bonus</span>}
                        <span>🏖 {ev.pto_days}d PTO</span>
                        <span>🏠 {ev.remote_type}</span>
                      </div>
                    </div>
                  </div>
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.6, margin: "var(--sp-2) 0" }}>{ev.analysis}</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
                    <div>
                      {ev.pros?.slice(0, 3).map((p, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#22c55e", display: "flex", gap: 4, marginBottom: 2 }}>
                          <span>✓</span><span style={{ color: "var(--color-text-muted)" }}>{p}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      {ev.cons?.slice(0, 3).map((c, i) => (
                        <div key={i} style={{ fontSize: 11, color: "#ef4444", display: "flex", gap: 4, marginBottom: 2 }}>
                          <span>✗</span><span style={{ color: "var(--color-text-muted)" }}>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
              <div style={{ height: "var(--sp-4)" }} />
            </div>
          )
        )}

        {/* ── COMPARE ──────────────────────────────────────────────── */}
        {tab === "compare" && (
          <div style={{ padding: "var(--sp-3)", overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "var(--sp-2)", color: "var(--color-text-muted)", fontSize: 10, textTransform: "uppercase" }}>Offer</th>
                  {evals.map(ev => (
                    <th key={ev.id} style={{ padding: "var(--sp-2)", textAlign: "center", color: "var(--color-text)", fontSize: 12, fontWeight: 700 }}>
                      {ev.company}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  { label: "Score",      render: (ev: OfferEval) => { const col = ev.score >= 7.5 ? "#22c55e" : ev.score >= 5 ? "#f59e0b" : "#ef4444"; return <span style={{ color: col, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{ev.score.toFixed(1)}</span>; } },
                  { label: "Base",       render: (ev: OfferEval) => fmt$(ev.base_salary) },
                  { label: "Bonus",      render: (ev: OfferEval) => ev.bonus > 0 ? fmt$(ev.bonus) : "—" },
                  { label: "PTO",        render: (ev: OfferEval) => `${ev.pto_days}d` },
                  { label: "Remote",     render: (ev: OfferEval) => ev.remote_type },
                  { label: "Equity",     render: (ev: OfferEval) => ev.equity || "—" },
                ].map(row => (
                  <tr key={row.label} style={{ borderTop: "1px solid var(--color-border-lo)" }}>
                    <td style={{ padding: "var(--sp-2)", color: "var(--color-text-muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em" }}>{row.label}</td>
                    {evals.map(ev => (
                      <td key={ev.id} style={{ padding: "var(--sp-2)", textAlign: "center", color: "var(--color-text)" }}>
                        {row.render(ev)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
