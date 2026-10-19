"use client";

import { useState, useEffect, useCallback } from "react";
import { Code2, Plus, Trash2, RefreshCw, Check, ExternalLink, GitBranch, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

interface PortfolioItem {
  id: string;
  name: string;
  description: string;
  tech_stack: string[];
  github_url: string;
  live_url: string;
  pitch: string;
  status: string;
  created_at: string;
}

export function PortfolioPanel() {
  const toast = useToast();

  const [items, setItems]       = useState<PortfolioItem[]>([]);
  const [loading, setLoading]   = useState(true);
  const [adding, setAdding]     = useState(false);
  const [saving, setSaving]     = useState(false);
  const [editId, setEditId]     = useState<string | null>(null);

  // Form state
  const [name, setName]           = useState("");
  const [desc, setDesc]           = useState("");
  const [stack, setStack]         = useState("");
  const [github, setGithub]       = useState("");
  const [live, setLive]           = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/portfolio`);
      if (res.ok) setItems((await res.json()).items || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function resetForm() { setName(""); setDesc(""); setStack(""); setGithub(""); setLive(""); setEditId(null); setAdding(false); }

  function startEdit(item: PortfolioItem) {
    setName(item.name);
    setDesc(item.description);
    setStack(item.tech_stack.join(", "));
    setGithub(item.github_url);
    setLive(item.live_url);
    setEditId(item.id);
    setAdding(true);
  }

  async function save() {
    if (!name.trim()) { toast("Project name required", "warning"); return; }
    setSaving(true);
    try {
      const body = {
        name,
        description: desc,
        tech_stack: stack.split(",").map(s => s.trim()).filter(Boolean),
        github_url: github,
        live_url: live,
      };
      const url  = editId ? `${API}/api/portfolio/${editId}` : `${API}/api/portfolio`;
      const method = editId ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast(editId ? "Project updated" : "Project added", "success");
      resetForm();
      load();
    } catch (e) {
      toast(`Failed: ${e instanceof Error ? e.message : "error"}`, "error");
    } finally { setSaving(false); }
  }

  async function deleteItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id));
    try { await fetch(`${API}/api/portfolio/${id}`, { method: "DELETE" }); }
    catch { load(); }
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Code2 size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Portfolio</span>
        <span style={{ marginLeft: "var(--sp-2)", fontSize: 9, color: "var(--color-text-muted)" }}>{items.length} projects</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
          <button
            onClick={() => { resetForm(); setAdding(a => !a); }}
            style={{ padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={11} /> Add Project
          </button>
        </div>
      </div>

      {/* Form */}
      {adding && (
        <div style={{ padding: "var(--sp-3)", borderBottom: "var(--border)", background: "var(--color-surface-raised)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <input className="sj-input" placeholder="Project name" value={name} onChange={e => setName(e.target.value)} autoFocus style={{ fontSize: 13 }} />
          <textarea className="sj-input" placeholder="Description" value={desc} onChange={e => setDesc(e.target.value)} rows={2} style={{ fontSize: 12, resize: "vertical" }} />
          <input className="sj-input" placeholder="Tech stack  (comma-separated: React, FastAPI, PostgreSQL)" value={stack} onChange={e => setStack(e.target.value)} style={{ fontSize: 12 }} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--sp-2)" }}>
            <input className="sj-input" placeholder="GitHub URL" value={github} onChange={e => setGithub(e.target.value)} style={{ fontSize: 12 }} />
            <input className="sj-input" placeholder="Live URL" value={live} onChange={e => setLive(e.target.value)} style={{ fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button onClick={save} disabled={saving || !name.trim()} style={{ flex: 1, padding: "6px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 12, cursor: "pointer", opacity: !name.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              {saving ? <><Loader2 size={12} className="sj-spin" /> Saving + generating pitch…</> : <><Check size={12} /> {editId ? "Update" : "Save"}</>}
            </button>
            <button onClick={resetForm} style={{ padding: "6px 14px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 12, cursor: "pointer", color: "var(--color-text-muted)" }}>Cancel</button>
          </div>
          {!editId && <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: 0 }}>💡 AI will auto-generate a 1-line pitch after saving.</p>}
        </div>
      )}

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 40, marginBottom: "var(--sp-3)" }}>🚀</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No projects yet. Add your portfolio items above.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {items.map(item => (
              <div key={item.id} style={{ padding: "var(--sp-3)", borderBottom: "1px solid var(--color-border-lo)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "var(--sp-2)", marginBottom: "var(--sp-2)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text)" }}>{item.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: "var(--sp-1)", alignItems: "center", flexShrink: 0 }}>
                    {item.github_url && (
                      <a href={item.github_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-icon)" }}>
                        <GitBranch size={13} />
                      </a>
                    )}
                    {item.live_url && (
                      <a href={item.live_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-icon)" }}>
                        <ExternalLink size={12} />
                      </a>
                    )}
                    <button onClick={() => startEdit(item)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "var(--color-text-muted)", padding: "2px 6px" }}>edit</button>
                    <button onClick={() => deleteItem(item.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                      <Trash2 size={11} />
                    </button>
                  </div>
                </div>

                {item.pitch && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--sp-1)", marginBottom: "var(--sp-2)" }}>
                    <Sparkles size={10} style={{ color: "var(--color-accent)", flexShrink: 0, marginTop: 2 }} />
                    <p style={{ fontSize: 12, color: "var(--color-text)", fontStyle: "italic", margin: 0, lineHeight: 1.5 }}>{item.pitch}</p>
                  </div>
                )}

                {item.description && (
                  <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "0 0 var(--sp-2)", lineHeight: 1.5 }}>{item.description}</p>
                )}

                {item.tech_stack?.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {item.tech_stack.map(t => (
                      <span key={t} style={{ fontSize: 9, padding: "1px 7px", borderRadius: "var(--r-full)", background: "var(--color-surface-raised)", border: "var(--border)", color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div style={{ height: "var(--sp-4)" }} />
          </div>
        )}
      </div>
    </div>
  );
}
