"use client";

import { useState, useEffect } from "react";
import { ShoppingBag, Plus, ChevronRight, Zap, Check, X } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Template {
  id: string;
  name: string;
  description: string;
  avatar_emoji: string;
  badge_color: string;
  department: string;
  level: number;
  model: string;
  system_prompt: string;
  capabilities: string[];
}

interface CreateForm {
  codename: string;
  name: string;
  department: string;
  title: string;
  level: number;
  model: string;
  system_prompt: string;
  avatar_emoji: string;
  badge_color: string;
  description: string;
}

const BLANK_FORM: CreateForm = {
  codename: "", name: "", department: "", title: "", level: 3,
  model: "llama-3.3-70b-versatile", system_prompt: "", avatar_emoji: "🤖",
  badge_color: "#94a3b8", description: "",
};

const LEVEL_LABELS: Record<number, string> = { 1: "L1", 2: "L2", 3: "L3", 4: "L4", 5: "L5" };
const MODELS = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
  "gemma2-9b-it",
];

interface Props { onNavigate?: (view: string) => void }

export function AgentMarketplacePanel({ onNavigate }: Props) {
  const [templates, setTemplates]   = useState<Template[]>([]);
  const [selected,  setSelected]    = useState<Template | null>(null);
  const [showForm,  setShowForm]    = useState(false);
  const [form,      setForm]        = useState<CreateForm>(BLANK_FORM);
  const [saving,    setSaving]      = useState(false);
  const [success,   setSuccess]     = useState<string | null>(null);
  const [error,     setError]       = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/api/agents/templates`)
      .then(r => r.json())
      .then(d => setTemplates(d.templates || []))
      .catch(() => {});
  }, []);

  function openTemplate(t: Template) {
    setSelected(t);
    setForm({
      codename:      t.id.replace(/_/g, "-"),
      name:          t.name,
      department:    t.department,
      title:         t.name,
      level:         t.level,
      model:         t.model,
      system_prompt: t.system_prompt,
      avatar_emoji:  t.avatar_emoji,
      badge_color:   t.badge_color,
      description:   t.description,
    });
    setShowForm(true);
    setSuccess(null);
    setError(null);
  }

  function openBlank() {
    setSelected(null);
    setForm({ ...BLANK_FORM });
    setShowForm(true);
    setSuccess(null);
    setError(null);
  }

  async function handleCreate() {
    if (!form.codename.trim() || !form.name.trim()) {
      setError("Codename and name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const body = {
        agent_id: `agent-${form.codename}-${Date.now()}`,
        codename: form.codename.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
        name: form.name,
        department: form.department || "General",
        title: form.title || form.name,
        level: form.level,
        model: form.model,
        system_prompt: form.system_prompt,
        avatar_emoji: form.avatar_emoji,
        badge_color: form.badge_color,
        description: form.description,
      };
      const res = await fetch(`${API}/api/agents/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `HTTP ${res.status}`);
      }
      setSuccess(`Agent "${form.name}" created! Navigate to Agents to activate it.`);
      setShowForm(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="sj-panel" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div style={{
        padding: "var(--sp-4) var(--sp-5)",
        borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ShoppingBag size={16} style={{ color: "var(--color-accent)" }} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>Agent Marketplace</span>
          <span style={{
            fontSize: 10, padding: "2px 7px",
            background: "color-mix(in srgb, var(--color-accent) 15%, transparent)",
            color: "var(--color-accent)", borderRadius: 12, fontWeight: 600,
          }}>
            {templates.length} templates
          </span>
        </div>
        <button
          onClick={openBlank}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "5px 12px", borderRadius: "var(--r-sm)",
            background: "var(--color-accent)", color: "#fff",
            border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
          }}
        >
          <Plus size={11} /> Custom Agent
        </button>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Template gallery */}
        <div style={{
          flex: showForm ? "0 0 340px" : "1",
          overflowY: "auto",
          padding: "var(--sp-3)",
          display: "grid",
          gridTemplateColumns: showForm ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "var(--sp-2)",
          alignContent: "start",
          transition: "flex 0.2s",
        }}>
          {templates.map(t => (
            <TemplateCard
              key={t.id}
              template={t}
              selected={selected?.id === t.id && showForm}
              onClick={() => openTemplate(t)}
            />
          ))}
          {templates.length === 0 && (
            <div style={{ color: "var(--color-text-muted)", fontSize: 12, padding: "var(--sp-4)", gridColumn: "1/-1" }}>
              Loading templates…
            </div>
          )}
        </div>

        {/* Create / edit form */}
        {showForm && (
          <div style={{
            flex: 1, overflowY: "auto",
            borderLeft: "1px solid var(--color-border)",
            padding: "var(--sp-4)",
            display: "flex", flexDirection: "column", gap: "var(--sp-3)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                {selected ? `Configure: ${selected.name}` : "New Custom Agent"}
              </span>
              <button
                onClick={() => setShowForm(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)" }}
              >
                <X size={14} />
              </button>
            </div>

            {/* Emoji + codename row */}
            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <input
                value={form.avatar_emoji}
                onChange={e => setForm(f => ({ ...f, avatar_emoji: e.target.value }))}
                style={{ width: 48, ...inputStyle, textAlign: "center", fontSize: 18 }}
                maxLength={4}
              />
              <input
                placeholder="codename (e.g. nova)"
                value={form.codename}
                onChange={e => setForm(f => ({ ...f, codename: e.target.value }))}
                style={{ flex: 1, ...inputStyle }}
              />
            </div>

            <Field label="Display Name">
              <input
                placeholder="e.g. Nova"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                style={inputStyle}
              />
            </Field>

            <Field label="Title">
              <input
                placeholder="e.g. Senior Research Analyst"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                style={inputStyle}
              />
            </Field>

            <div style={{ display: "flex", gap: "var(--sp-2)" }}>
              <Field label="Department" style={{ flex: 1 }}>
                <input
                  placeholder="e.g. Research"
                  value={form.department}
                  onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
                  style={inputStyle}
                />
              </Field>
              <Field label="Level" style={{ width: 90 }}>
                <select
                  value={form.level}
                  onChange={e => setForm(f => ({ ...f, level: Number(e.target.value) }))}
                  style={inputStyle}
                >
                  {[1,2,3,4,5].map(n => (
                    <option key={n} value={n}>{LEVEL_LABELS[n]} — {["Junior","Mid","Senior","Lead","Director"][n-1]}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Model">
              <select
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                style={inputStyle}
              >
                {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>

            <Field label="Badge Colour">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="color"
                  value={form.badge_color}
                  onChange={e => setForm(f => ({ ...f, badge_color: e.target.value }))}
                  style={{ width: 36, height: 28, padding: 2, borderRadius: 4, border: "1px solid var(--color-border)", cursor: "pointer" }}
                />
                <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                  {form.badge_color}
                </span>
              </div>
            </Field>

            <Field label="Description">
              <input
                placeholder="One-line description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                style={inputStyle}
              />
            </Field>

            <Field label="System Prompt">
              <textarea
                placeholder="You are…"
                value={form.system_prompt}
                onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
                rows={8}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.6 }}
              />
            </Field>

            {error && (
              <div style={{
                padding: "8px 12px", borderRadius: "var(--r-sm)", fontSize: 11,
                background: "color-mix(in srgb, #ef4444 10%, transparent)",
                color: "#ef4444", border: "1px solid color-mix(in srgb, #ef4444 25%, transparent)",
              }}>
                {error}
              </div>
            )}

            {success && (
              <div style={{
                padding: "8px 12px", borderRadius: "var(--r-sm)", fontSize: 11,
                background: "color-mix(in srgb, #22c55e 10%, transparent)",
                color: "#22c55e", border: "1px solid color-mix(in srgb, #22c55e 25%, transparent)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <Check size={12} /> {success}
                {onNavigate && (
                  <button
                    onClick={() => onNavigate("agents")}
                    style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#22c55e", display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}
                  >
                    Go to Agents <ChevronRight size={11} />
                  </button>
                )}
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={saving}
              style={{
                padding: "8px 16px", borderRadius: "var(--r-sm)",
                background: saving ? "var(--color-border)" : "var(--color-accent)",
                color: saving ? "var(--color-text-muted)" : "#fff",
                border: "none", cursor: saving ? "not-allowed" : "pointer",
                fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
              }}
            >
              <Zap size={12} />
              {saving ? "Creating…" : "Create Agent"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ template: t, selected, onClick }: {
  template: Template; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: selected
          ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
          : "var(--color-surface)",
        border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-border)"}`,
        borderRadius: "var(--r-md)", padding: "var(--sp-3)",
        cursor: "pointer", textAlign: "left", width: "100%",
        display: "flex", flexDirection: "column", gap: 6,
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20 }}>{t.avatar_emoji}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {t.name}
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {t.department} · L{t.level}
          </div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: t.badge_color, display: "block",
          }} />
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
        {t.description}
      </div>
      {t.capabilities?.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {t.capabilities.slice(0, 4).map(c => (
            <span key={c} style={{
              fontSize: 9, padding: "1px 6px",
              background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
              color: "var(--color-accent)", borderRadius: 10, fontWeight: 500,
            }}>
              {c}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function Field({ label, children, style }: {
  label: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, ...style }}>
      <label style={{ fontSize: 10, fontWeight: 600, color: "var(--color-text-muted)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "6px 10px", borderRadius: "var(--r-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)", color: "var(--color-text-primary)",
  fontSize: 11, outline: "none",
};
