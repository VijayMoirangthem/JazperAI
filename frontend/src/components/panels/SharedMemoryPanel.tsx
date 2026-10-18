"use client";
import { useEffect, useState, useCallback } from "react";
import { Brain, Search, Trash2, Plus, X, Tag, User } from "lucide-react";

interface SharedMemory {
  id: string;
  key: string;
  value: string;
  writing_agent: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export default function SharedMemoryPanel() {
  const [memories, setMemories] = useState<SharedMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [agents, setAgents] = useState<{ agent: string; count: number }[]>([]);
  const [showWrite, setShowWrite] = useState(false);
  const [form, setForm] = useState({ key: "", value: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<SharedMemory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (agentFilter) params.set("agent", agentFilter);
      if (tagFilter) params.set("tag", tagFilter);
      const [memRes, agentRes] = await Promise.all([
        fetch(`/api/shared-memory?${params}`),
        fetch("/api/shared-memory/agents"),
      ]);
      setMemories(await memRes.json());
      setAgents(await agentRes.json());
    } finally {
      setLoading(false);
    }
  }, [search, agentFilter, tagFilter]);

  useEffect(() => { load(); }, [load]);

  async function handleWrite() {
    if (!form.key.trim() || !form.value.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/shared-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: form.key.trim(),
          value: form.value.trim(),
          tags: form.tags.split(",").map(t => t.trim()).filter(Boolean),
          writing_agent: "user",
        }),
      });
      setForm({ key: "", value: "", tags: "" });
      setShowWrite(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(key: string) {
    await fetch(`/api/shared-memory/${encodeURIComponent(key)}`, { method: "DELETE" });
    load();
  }

  const fmtDate = (s: string) => new Date(s).toLocaleString();

  return (
    <div style={{ padding: 24, height: "100%", overflowY: "auto", background: "#0f0f13", color: "#e2e8f0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Brain size={22} color="#a78bfa" />
          <span style={{ fontSize: 20, fontWeight: 700, color: "#a78bfa" }}>Shared Memory</span>
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: 4 }}>Cross-agent knowledge store</span>
        </div>
        <button
          onClick={() => setShowWrite(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "#4f46e5", color: "#fff",
            border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13 }}
        >
          <Plus size={14} /> Write Memory
        </button>
      </div>

      {/* Write form */}
      {showWrite && (
        <div style={{ background: "#1e1b2e", border: "1px solid #4f46e5", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontWeight: 600, color: "#a78bfa" }}>Write to shared memory</span>
            <button onClick={() => setShowWrite(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
              <X size={16} />
            </button>
          </div>
          <input
            placeholder="Key (unique identifier, e.g. scout/company-contacts)"
            value={form.key}
            onChange={e => setForm(f => ({ ...f, key: e.target.value }))}
            style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
              padding: "8px 12px", color: "#e2e8f0", fontSize: 13, marginBottom: 10, boxSizing: "border-box" }}
          />
          <textarea
            placeholder="Value (knowledge, JSON, text…)"
            value={form.value}
            onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
            rows={4}
            style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
              padding: "8px 12px", color: "#e2e8f0", fontSize: 13, marginBottom: 10,
              resize: "vertical", boxSizing: "border-box" }}
          />
          <input
            placeholder="Tags (comma-separated, optional)"
            value={form.tags}
            onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
            style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
              padding: "8px 12px", color: "#e2e8f0", fontSize: 13, marginBottom: 14, boxSizing: "border-box" }}
          />
          <button
            onClick={handleWrite} disabled={saving}
            style={{ background: "#4f46e5", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 18px", cursor: "pointer", fontSize: 13 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200, position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#64748b" }} />
          <input
            placeholder="Search keys & values…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: "100%", background: "#1e1b2e", border: "1px solid #2d2d3a", borderRadius: 6,
              padding: "8px 12px 8px 32px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }}
          />
        </div>
        <select
          value={agentFilter}
          onChange={e => setAgentFilter(e.target.value)}
          style={{ background: "#1e1b2e", border: "1px solid #2d2d3a", borderRadius: 6,
            padding: "8px 12px", color: "#e2e8f0", fontSize: 13 }}
        >
          <option value="">All agents</option>
          {agents.map(a => (
            <option key={a.agent} value={a.agent}>{a.agent} ({a.count})</option>
          ))}
        </select>
        <input
          placeholder="Filter by tag…"
          value={tagFilter}
          onChange={e => setTagFilter(e.target.value)}
          style={{ background: "#1e1b2e", border: "1px solid #2d2d3a", borderRadius: 6,
            padding: "8px 12px", color: "#e2e8f0", fontSize: 13, width: 140 }}
        />
      </div>

      {/* Memory detail drawer */}
      {selected && (
        <div style={{ background: "#1e1b2e", border: "1px solid #4f46e5", borderRadius: 10, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontWeight: 600, color: "#a78bfa", wordBreak: "break-all" }}>{selected.key}</span>
            <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
              <X size={16} />
            </button>
          </div>
          <pre style={{ background: "#0f0f13", borderRadius: 6, padding: 14, fontSize: 12, color: "#e2e8f0",
            whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300, overflowY: "auto", margin: 0 }}>
            {selected.value}
          </pre>
          <div style={{ marginTop: 10, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {selected.tags.map(t => (
              <span key={t} style={{ background: "#312e81", color: "#a78bfa", borderRadius: 4, padding: "2px 8px", fontSize: 11 }}>{t}</span>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: "#64748b" }}>
            Written by <strong style={{ color: "#94a3b8" }}>{selected.writing_agent}</strong> · Updated {fmtDate(selected.updated_at)}
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#64748b", paddingTop: 40 }}>Loading…</div>
      ) : memories.length === 0 ? (
        <div style={{ textAlign: "center", color: "#64748b", paddingTop: 40 }}>No shared memories yet. Agents write here using share_memory.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {memories.map(m => (
            <div
              key={m.id}
              onClick={() => setSelected(m)}
              style={{ background: "#1a1a24", border: `1px solid ${selected?.id === m.id ? "#4f46e5" : "#2d2d3a"}`,
                borderRadius: 8, padding: "12px 16px", cursor: "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "flex-start",
                transition: "border-color 0.15s" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0", marginBottom: 3,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.key}
                </div>
                <div style={{ fontSize: 12, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap", maxWidth: "60vw" }}>
                  {m.value.slice(0, 120)}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#64748b" }}>
                    <User size={10} /> {m.writing_agent}
                  </span>
                  {m.tags.slice(0, 3).map(t => (
                    <span key={t} style={{ background: "#1e1b2e", border: "1px solid #312e81",
                      color: "#a78bfa", borderRadius: 3, padding: "1px 6px", fontSize: 10,
                      display: "flex", alignItems: "center", gap: 3 }}>
                      <Tag size={8} /> {t}
                    </span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12 }}>
                <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                  {fmtDate(m.updated_at)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); handleDelete(m.key); }}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626", padding: 4 }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
