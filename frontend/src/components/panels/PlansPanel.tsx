"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Trash2, ChevronDown, ChevronRight } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Step = {
  title:       string;
  description: string;
  status:      string;
  result:      string;
};

type Plan = {
  id:          string;
  title:       string;
  description: string;
  agent:       string;
  steps:       Step[];
  status:      string;
  created_at:  string;
  updated_at:  string;
};

const STATUS_COLOR: Record<string, string> = {
  pending:   "#94a3b8",
  running:   "#f59e0b",
  done:      "#22c55e",
  completed: "#22c55e",
  failed:    "#ef4444",
  skipped:   "#6b7280",
};

const STATUS_BG: Record<string, string> = {
  pending:   "rgba(148,163,184,0.1)",
  running:   "rgba(245,158,11,0.15)",
  done:      "rgba(34,197,94,0.1)",
  completed: "rgba(34,197,94,0.1)",
  failed:    "rgba(239,68,68,0.12)",
  skipped:   "rgba(107,114,128,0.1)",
};

function StepRow({ step, index }: { step: Step; index: number }) {
  const color = STATUS_COLOR[step.status] ?? "#94a3b8";
  const isDone = step.status === "done" || step.status === "completed";
  return (
    <div style={{
      display:    "flex",
      gap:        10,
      alignItems: "flex-start",
      padding:    "8px 0",
      borderBottom: "1px solid var(--color-border)",
      opacity:    step.status === "skipped" ? 0.45 : 1,
    }}>
      {/* Step number / status dot */}
      <div style={{
        width:         22,
        height:        22,
        borderRadius:  "50%",
        border:        `2px solid ${color}`,
        background:    isDone ? color : "transparent",
        display:       "flex",
        alignItems:    "center",
        justifyContent:"center",
        flexShrink:    0,
        fontSize:      10,
        fontWeight:    700,
        color:         isDone ? "#000" : color,
        marginTop:     1,
      }}>
        {isDone ? "✓" : index + 1}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{
          fontSize:       12,
          fontWeight:     600,
          textDecoration: step.status === "skipped" ? "line-through" : "none",
        }}>
          {step.title}
        </div>
        {step.description && (
          <div style={{ fontSize: 11, opacity: 0.55, marginTop: 2 }}>{step.description}</div>
        )}
        {step.result && (
          <div style={{ fontSize: 11, color, marginTop: 4, fontStyle: "italic" }}>
            {step.result}
          </div>
        )}
      </div>

      <span style={{
        fontSize:     9,
        fontWeight:   700,
        letterSpacing:"0.06em",
        textTransform:"uppercase",
        color,
        flexShrink:   0,
        marginTop:    3,
      }}>
        {step.status}
      </span>
    </div>
  );
}

function PlanCard({ plan, onDelete }: { plan: Plan; onDelete: () => void }) {
  const [open, setOpen] = useState(plan.status === "running" || plan.status === "pending");
  const color   = STATUS_COLOR[plan.status] ?? "#94a3b8";
  const bg      = STATUS_BG[plan.status]    ?? "transparent";
  const doneCount = plan.steps.filter(s => s.status === "done" || s.status === "completed").length;

  return (
    <div style={{
      background:   "var(--color-surface)",
      border:       `1px solid var(--color-border)`,
      borderLeft:   `3px solid ${color}`,
      borderRadius: 8,
      marginBottom: 10,
      overflow:     "hidden",
    }}>
      {/* Plan header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width:          "100%",
          display:        "flex",
          alignItems:     "center",
          gap:            10,
          padding:        "12px 14px",
          background:     bg,
          border:         "none",
          cursor:         "pointer",
          color:          "var(--color-text)",
          textAlign:      "left",
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{plan.title}</div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>
            {plan.agent} · {doneCount}/{plan.steps.length} steps · {new Date(plan.created_at).toLocaleDateString()}
          </div>
        </div>
        <span style={{
          fontSize:     9,
          fontWeight:   700,
          letterSpacing:"0.06em",
          textTransform:"uppercase",
          color,
          flexShrink:   0,
        }}>
          {plan.status}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", opacity: 0.5, padding: 2 }}
        >
          <Trash2 size={12} />
        </button>
      </button>

      {/* Steps */}
      {open && (
        <div style={{ padding: "0 14px 12px" }}>
          {plan.description && (
            <p style={{ margin: "8px 0", fontSize: 12, opacity: 0.6 }}>{plan.description}</p>
          )}
          {plan.steps.map((step, i) => (
            <StepRow key={i} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

export function PlansPanel() {
  const [plans,   setPlans]   = useState<Plan[]>([]);
  const [filter,  setFilter]  = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = filter === "all"
        ? `${API}/api/plans/`
        : `${API}/api/plans/?status=${filter}`;
      const r = await fetch(url);
      const d = await r.json();
      setPlans(d.plans ?? []);
    } catch { /* offline */ }
    setLoading(false);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 4s while any plan is running or pending
  useEffect(() => {
    const hasActive = plans.some(p => p.status === "running" || p.status === "pending");
    if (!hasActive) return;
    const iv = setInterval(load, 4000);
    return () => clearInterval(iv);
  }, [plans, load]);

  async function deletePlan(id: string) {
    await fetch(`${API}/api/plans/${id}`, { method: "DELETE" });
    setPlans(p => p.filter(x => x.id !== id));
  }

  const filters = ["all", "running", "pending", "completed", "failed"];

  const active   = plans.filter(p => p.status === "running" || p.status === "pending");
  const finished = plans.filter(p => p.status !== "running" && p.status !== "pending");

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 className="sj-heading" style={{ margin: 0, flex: 1 }}>Agent Plans</h2>
        <div style={{ display: "flex", gap: 4 }}>
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                background:  filter === f ? "var(--color-accent)" : "var(--color-surface)",
                color:       filter === f ? "#000" : "var(--color-text)",
                border:      "1px solid var(--color-border)",
                borderRadius:5,
                padding:     "4px 10px",
                fontSize:    11,
                cursor:      "pointer",
                fontWeight:  filter === f ? 700 : 400,
              }}
            >
              {f}
            </button>
          ))}
        </div>
        <button
          onClick={load}
          style={{ background: "none", border: "1px solid var(--color-border)", borderRadius: 5, padding: "4px 8px", cursor: "pointer", color: "var(--color-text)" }}
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && <p style={{ opacity: 0.4, fontSize: 12 }}>Loading plans…</p>}

        {!loading && plans.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 60, opacity: 0.35 }}>
            <p style={{ fontSize: 13, margin: 0 }}>No plans yet.</p>
            <p style={{ fontSize: 11, marginTop: 6 }}>
              Plans are created when Jazper executes multi-step tasks.
            </p>
          </div>
        )}

        {active.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
              Active
            </div>
            {active.map(p => (
              <PlanCard key={p.id} plan={p} onDelete={() => deletePlan(p.id)} />
            ))}
          </>
        )}

        {finished.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, opacity: 0.5, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8, marginTop: active.length > 0 ? 16 : 0 }}>
              History
            </div>
            {finished.map(p => (
              <PlanCard key={p.id} plan={p} onDelete={() => deletePlan(p.id)} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
