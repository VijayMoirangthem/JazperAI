"use client";

import { useState, useEffect, useCallback } from "react";
import { Target, Plus, Trash2, RefreshCw, ChevronDown, ChevronRight, Check, Loader2 } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type MetricType = "percent" | "number" | "boolean";
type GoalType   = "quarterly" | "monthly" | "weekly";
type GoalStatus = "active" | "completed" | "paused";

interface KeyResult {
  id: string;
  title: string;
  metric_type: MetricType;
  current_value: number;
  target_value: number;
  unit: string;
}

interface Goal {
  id: string;
  title: string;
  description: string;
  type: GoalType;
  status: GoalStatus;
  target_date: string | null;
  progress: number;
  key_results: KeyResult[];
  created_at: string;
}

const TYPE_META: Record<GoalType, { label: string; color: string }> = {
  quarterly: { label: "Quarterly", color: "#8b5cf6" },
  monthly:   { label: "Monthly",   color: "#3b82f6" },
  weekly:    { label: "Weekly",    color: "#22c55e" },
};

const STATUS_META: Record<GoalStatus, { label: string; color: string }> = {
  active:    { label: "Active",    color: "#22c55e" },
  completed: { label: "Done",      color: "#6b7280" },
  paused:    { label: "Paused",    color: "#f59e0b" },
};

function ProgressBar({ value, color }: { value: number; color: string }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={{ height: 6, background: "var(--color-surface-raised)", borderRadius: "var(--r-full)", overflow: "hidden", flex: 1 }}>
      <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "var(--r-full)", transition: "width 0.4s ease" }} />
    </div>
  );
}

export function GoalsPanel() {
  const toast = useToast();

  const [goals, setGoals]         = useState<Goal[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showAll, setShowAll]     = useState(false);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  // Add goal form
  const [adding, setAdding]       = useState(false);
  const [newTitle, setNewTitle]   = useState("");
  const [newDesc, setNewDesc]     = useState("");
  const [newType, setNewType]     = useState<GoalType>("quarterly");
  const [newDate, setNewDate]     = useState("");
  const [saving, setSaving]       = useState(false);

  // Add KR form — per goal
  const [addingKR, setAddingKR]   = useState<string | null>(null);
  const [krTitle, setKrTitle]     = useState("");
  const [krTarget, setKrTarget]   = useState("100");
  const [krUnit, setKrUnit]       = useState("%");
  const [krSaving, setKrSaving]   = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/goals?status=${showAll ? "all" : "active"}`);
      if (res.ok) setGoals((await res.json()).goals || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [showAll]);

  useEffect(() => { load(); }, [load]);

  async function addGoal() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/goals`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, description: newDesc, type: newType, target_date: newDate || null }),
      });
      if (!res.ok) throw new Error();
      toast("Goal created", "success");
      setAdding(false); setNewTitle(""); setNewDesc(""); setNewDate("");
      load();
    } catch { toast("Failed to save goal", "error"); } finally { setSaving(false); }
  }

  async function deleteGoal(id: string) {
    setGoals(prev => prev.filter(g => g.id !== id));
    try { await fetch(`${API}/api/goals/${id}`, { method: "DELETE" }); }
    catch { load(); }
  }

  async function markDone(goal: Goal) {
    try {
      await fetch(`${API}/api/goals/${goal.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: goal.status === "completed" ? "active" : "completed" }),
      });
      load();
    } catch { toast("Failed to update", "error"); }
  }

  async function addKR(goalId: string) {
    if (!krTitle.trim()) return;
    setKrSaving(true);
    try {
      const res = await fetch(`${API}/api/goals/${goalId}/key-results`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: krTitle, target_value: Number(krTarget) || 100, unit: krUnit }),
      });
      if (!res.ok) throw new Error();
      toast("Key result added", "success");
      setAddingKR(null); setKrTitle(""); setKrTarget("100"); setKrUnit("%");
      load();
    } catch { toast("Failed to add key result", "error"); } finally { setKrSaving(false); }
  }

  async function updateKRValue(goalId: string, krId: string, value: number) {
    try {
      await fetch(`${API}/api/goals/${goalId}/key-results/${krId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_value: value }),
      });
      load();
    } catch { toast("Failed to update", "error"); }
  }

  async function deleteKR(goalId: string, krId: string) {
    try {
      await fetch(`${API}/api/goals/${goalId}/key-results/${krId}`, { method: "DELETE" });
      load();
    } catch { toast("Failed to delete", "error"); }
  }

  function toggleExpand(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const activeGoals    = goals.filter(g => g.status === "active");
  const completedGoals = goals.filter(g => g.status === "completed");
  const avgProgress    = activeGoals.length > 0 ? activeGoals.reduce((s, g) => s + g.progress, 0) / activeGoals.length : 0;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Target size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Goals & OKRs</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button onClick={() => setShowAll(s => !s)} style={{ fontSize: 11, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer" }}>
            {showAll ? "Active only" : "Show all"}
          </button>
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
          <button
            onClick={() => setAdding(a => !a)}
            style={{ padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={11} /> New Goal
          </button>
        </div>
      </div>

      {/* Summary strip */}
      {goals.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, background: "var(--color-border)", borderBottom: "var(--border)", flexShrink: 0 }}>
          {[
            { label: "Active",    value: activeGoals.length },
            { label: "Completed", value: completedGoals.length },
            { label: "Avg Progress", value: `${Math.round(avgProgress)}%` },
          ].map(s => (
            <div key={s.label} style={{ padding: "var(--sp-2)", textAlign: "center", background: "var(--color-bg)" }}>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>{s.value}</div>
              <div style={{ fontSize: 9, color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {/* Add goal form */}
        {adding && (
          <div style={{ padding: "var(--sp-3)", borderBottom: "var(--border)", background: "var(--color-surface-raised)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <input className="sj-input" placeholder="Goal title" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus style={{ fontSize: 13 }} />
            <input className="sj-input" placeholder="Description (optional)" value={newDesc} onChange={e => setNewDesc(e.target.value)} style={{ fontSize: 12 }} />
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <select
                value={newType}
                onChange={e => setNewType(e.target.value as GoalType)}
                className="sj-input"
                style={{ fontSize: 12, flex: 1 }}
              >
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </select>
              <input type="date" className="sj-input" value={newDate} onChange={e => setNewDate(e.target.value)} style={{ fontSize: 12, flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <button onClick={addGoal} disabled={saving || !newTitle.trim()} style={{ flex: 1, padding: "6px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 12, cursor: "pointer", opacity: !newTitle.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                {saving ? <Loader2 size={12} className="sj-spin" /> : <Check size={12} />} Save
              </button>
              <button onClick={() => setAdding(false)} style={{ padding: "6px 12px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 12, cursor: "pointer", color: "var(--color-text-muted)" }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : goals.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>🎯</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No goals yet. Create your first OKR above.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {goals.map(goal => {
              const isOpen  = expanded.has(goal.id);
              const typeMeta   = TYPE_META[goal.type] || TYPE_META.quarterly;
              const statusMeta = STATUS_META[goal.status] || STATUS_META.active;
              const isDone  = goal.status === "completed";

              return (
                <div key={goal.id} style={{ borderBottom: "1px solid var(--color-border-lo)" }}>
                  {/* Goal row */}
                  <div
                    onClick={() => toggleExpand(goal.id)}
                    style={{ padding: "var(--sp-3)", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "var(--sp-2)", opacity: isDone ? 0.6 : 1 }}
                  >
                    <button
                      onClick={e => { e.stopPropagation(); markDone(goal); }}
                      style={{ width: 18, height: 18, borderRadius: "var(--r-sm)", border: isDone ? "none" : "var(--border)", background: isDone ? "#22c55e" : "var(--color-surface-raised)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}
                    >
                      {isDone && <Check size={10} color="#fff" />}
                    </button>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)" }}>{goal.title}</span>
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: "var(--r-full)", background: `${typeMeta.color}18`, border: `1px solid ${typeMeta.color}44`, color: typeMeta.color, fontWeight: 700 }}>
                          {typeMeta.label}
                        </span>
                        {goal.status !== "active" && (
                          <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: "var(--r-full)", background: `${statusMeta.color}18`, border: `1px solid ${statusMeta.color}44`, color: statusMeta.color, fontWeight: 700 }}>
                            {statusMeta.label}
                          </span>
                        )}
                      </div>

                      {/* Progress */}
                      {goal.key_results.length > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                          <ProgressBar value={goal.progress} color={typeMeta.color} />
                          <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0, width: 32 }}>
                            {Math.round(goal.progress)}%
                          </span>
                        </div>
                      )}

                      {goal.description && (
                        <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "var(--sp-1)", margin: 0 }}>{goal.description}</p>
                      )}
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)", flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); deleteGoal(goal.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                        <Trash2 size={11} />
                      </button>
                      {isOpen ? <ChevronDown size={11} style={{ color: "var(--color-icon)" }} /> : <ChevronRight size={11} style={{ color: "var(--color-icon)" }} />}
                    </div>
                  </div>

                  {/* Expanded: key results */}
                  {isOpen && (
                    <div style={{ paddingLeft: 40, paddingRight: "var(--sp-3)", paddingBottom: "var(--sp-3)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                      {goal.key_results.map(kr => (
                        <div key={kr.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, color: "var(--color-text)", marginBottom: 2 }}>{kr.title}</div>
                            <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                              <ProgressBar value={(kr.current_value / kr.target_value) * 100} color={typeMeta.color} />
                              <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0, whiteSpace: "nowrap" }}>
                                {kr.current_value}{kr.unit} / {kr.target_value}{kr.unit}
                              </span>
                            </div>
                          </div>
                          <input
                            type="number"
                            min={0} max={kr.target_value * 2}
                            defaultValue={kr.current_value}
                            onBlur={e => { const v = Number(e.target.value); if (v !== kr.current_value) updateKRValue(goal.id, kr.id, v); }}
                            onClick={e => e.stopPropagation()}
                            className="sj-input"
                            style={{ width: 60, fontSize: 11, textAlign: "center", padding: "3px 6px", fontFamily: "var(--font-mono)" }}
                          />
                          <button onClick={e => { e.stopPropagation(); deleteKR(goal.id, kr.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                            <Trash2 size={10} />
                          </button>
                        </div>
                      ))}

                      {/* Add KR */}
                      {addingKR === goal.id ? (
                        <div style={{ display: "flex", gap: "var(--sp-1)", flexWrap: "wrap" }}>
                          <input className="sj-input" placeholder="Key result title" value={krTitle} onChange={e => setKrTitle(e.target.value)} autoFocus style={{ flex: 2, minWidth: 120, fontSize: 11 }} />
                          <input type="number" className="sj-input" placeholder="Target" value={krTarget} onChange={e => setKrTarget(e.target.value)} style={{ width: 60, fontSize: 11 }} />
                          <input className="sj-input" placeholder="Unit" value={krUnit} onChange={e => setKrUnit(e.target.value)} style={{ width: 40, fontSize: 11 }} />
                          <button onClick={() => addKR(goal.id)} disabled={krSaving || !krTitle.trim()} style={{ padding: "4px 10px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 3 }}>
                            {krSaving ? <Loader2 size={10} className="sj-spin" /> : <Check size={10} />}
                          </button>
                          <button onClick={() => { setAddingKR(null); setKrTitle(""); }} style={{ padding: "4px 8px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 11, cursor: "pointer", color: "var(--color-text-muted)" }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={() => { setAddingKR(goal.id); setKrTitle(""); setKrTarget("100"); setKrUnit("%"); }} style={{ fontSize: 11, color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, display: "flex", alignItems: "center", gap: 3 }}>
                          <Plus size={10} /> Add key result
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
