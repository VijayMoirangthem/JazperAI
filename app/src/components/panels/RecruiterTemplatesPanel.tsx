"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Copy, Plus, Pencil, Trash2, Check, X, RefreshCw } from "lucide-react";

const API = "http://localhost:8000";

interface Template {
  id: string;
  name: string;
  category: string;
  body: string;
  created_at: string | null;
}

const CATEGORY_COLOR: Record<string, string> = {
  recruiter: "#6366f1",
  interview: "#f59e0b",
  offer:     "#22c55e",
  custom:    "#6b7280",
};

const CATEGORY_LABEL: Record<string, string> = {
  recruiter: "Recruiter",
  interview: "Interview",
  offer:     "Offer",
  custom:    "Custom",
};

function CategoryBadge({ cat }: { cat: string }) {
  const color = CATEGORY_COLOR[cat] || CATEGORY_COLOR.custom;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: "var(--r-full)",
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid ${color}44`, color, textTransform: "capitalize",
    }}>
      {CATEGORY_LABEL[cat] || cat}
    </span>
  );
}

interface EditState {
  id: string | null;
  name: string;
  category: string;
  body: string;
}

const EMPTY_EDIT: EditState = { id: null, name: "", category: "custom", body: "" };

export function RecruiterTemplatesPanel() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [copied, setCopied]       = useState<string | null>(null);
  const [editing, setEditing]     = useState<EditState | null>(null);
  const [saving, setSaving]       = useState(false);
  const [filterCat, setFilterCat] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/templates`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function copyBody(id: string, body: string) {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* silent */ }
  }

  function useAsReply(body: string) {
    localStorage.setItem("sj_compose_prefill", JSON.stringify({ body }));
    window.location.hash = "compose";
  }

  async function saveTemplate() {
    if (!editing || !editing.name.trim() || !editing.body.trim()) return;
    setSaving(true);
    try {
      const url    = editing.id ? `${API}/api/templates/${editing.id}` : `${API}/api/templates`;
      const method = editing.id ? "PUT" : "POST";
      await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editing.name, category: editing.category, body: editing.body }),
      });
      setEditing(null);
      await load();
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  }

  async function deleteTemplate(id: string) {
    setTemplates(prev => prev.filter(t => t.id !== id));
    try {
      await fetch(`${API}/api/templates/${id}`, { method: "DELETE" });
    } catch { load(); }
  }

  const categories = ["all", ...Array.from(new Set(templates.map(t => t.category)))];
  const visible    = filterCat === "all" ? templates : templates.filter(t => t.category === filterCat);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <FileText size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Response Templates</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button
            onClick={() => setEditing({ ...EMPTY_EDIT })}
            style={{
              display: "flex", alignItems: "center", gap: 3,
              padding: "3px 8px", borderRadius: "var(--r-sm)",
              background: "var(--color-accent)", border: "none",
              color: "#fff", fontSize: 11, cursor: "pointer", fontWeight: 500,
            }}
          >
            <Plus size={10} /> New
          </button>
          <button
            onClick={load}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}
          >
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
        </div>
      </div>

      {/* Category filter */}
      <div style={{
        display: "flex", gap: 2, padding: "var(--sp-2) var(--sp-3)",
        borderBottom: "var(--border)", flexShrink: 0, overflowX: "auto",
      }}>
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setFilterCat(cat)}
            style={{
              padding: "4px 10px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
              border: "none", cursor: "pointer", flexShrink: 0, textTransform: "capitalize",
              background: filterCat === cat ? "var(--color-surface-raised)" : "none",
              color: filterCat === cat ? "var(--color-text)" : "var(--color-text-muted)",
            }}
          >
            {cat === "all" ? "All" : CATEGORY_LABEL[cat] || cat}
          </button>
        ))}
      </div>

      {/* Edit form */}
      {editing && (
        <div style={{
          padding: "var(--sp-3)", borderBottom: "var(--border)", flexShrink: 0,
          background: "var(--color-surface-raised)", display: "flex", flexDirection: "column", gap: "var(--sp-2)",
        }}>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <input
              className="sj-input"
              placeholder="Template name"
              value={editing.name}
              onChange={e => setEditing(prev => prev ? { ...prev, name: e.target.value } : null)}
              style={{ flex: 1, fontSize: 12 }}
              autoFocus
            />
            <select
              value={editing.category}
              onChange={e => setEditing(prev => prev ? { ...prev, category: e.target.value } : null)}
              style={{
                padding: "0 var(--sp-2)", borderRadius: "var(--r-sm)",
                background: "var(--color-surface-raised)", border: "var(--border)",
                color: "var(--color-text)", fontSize: 12, cursor: "pointer",
              }}
            >
              {["recruiter", "interview", "offer", "custom"].map(c => (
                <option key={c} value={c}>{CATEGORY_LABEL[c] || c}</option>
              ))}
            </select>
          </div>
          <textarea
            className="sj-input"
            placeholder="Template body…"
            value={editing.body}
            onChange={e => setEditing(prev => prev ? { ...prev, body: e.target.value } : null)}
            rows={4}
            style={{ fontSize: 12, resize: "vertical", minHeight: 80 }}
          />
          <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "flex-end" }}>
            <button
              onClick={() => setEditing(null)}
              style={{
                padding: "5px 12px", borderRadius: "var(--r-sm)", fontSize: 11,
                background: "none", border: "var(--border)", cursor: "pointer",
                color: "var(--color-text-muted)",
              }}
            >
              <X size={10} /> Cancel
            </button>
            <button
              onClick={saveTemplate}
              disabled={saving || !editing.name.trim() || !editing.body.trim()}
              style={{
                padding: "5px 14px", borderRadius: "var(--r-sm)", fontSize: 11, fontWeight: 500,
                background: "var(--color-accent)", border: "none", color: "#fff",
                cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <Check size={10} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading && templates.length === 0 ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : error ? (
          <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", padding: "var(--sp-4)" }}>{error}</p>
        ) : visible.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 36, marginBottom: "var(--sp-3)" }}>📄</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No templates yet. Click + New to create one.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {visible.map(t => (
              <div key={t.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                  <CategoryBadge cat={t.category} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.name}
                  </span>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => copyBody(t.id, t.body)}
                      title="Copy to clipboard"
                      style={{ background: "none", border: "none", cursor: "pointer", color: copied === t.id ? "#22c55e" : "var(--color-text-muted)", padding: 3, display: "flex" }}
                    >
                      {copied === t.id ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                    <button
                      onClick={() => setEditing({ id: t.id, name: t.name, category: t.category, body: t.body })}
                      title="Edit"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 3, display: "flex" }}
                    >
                      <Pencil size={11} />
                    </button>
                    <button
                      onClick={() => deleteTemplate(t.id)}
                      title="Delete"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 3, display: "flex" }}
                    >
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>
                <p style={{
                  fontSize: 12, color: "var(--color-text-muted)", lineHeight: 1.55,
                  margin: "0 0 var(--sp-2)", display: "-webkit-box",
                  WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden",
                }}>
                  {t.body}
                </p>
                <button
                  onClick={() => useAsReply(t.body)}
                  style={{
                    fontSize: 11, padding: "3px 10px", borderRadius: "var(--r-sm)",
                    background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                    border: "1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)",
                    color: "var(--color-accent)", cursor: "pointer", fontWeight: 500,
                  }}
                >
                  Use as Reply →
                </button>
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
