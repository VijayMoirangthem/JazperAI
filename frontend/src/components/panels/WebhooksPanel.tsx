"use client";
import { useEffect, useState, useCallback } from "react";
import { Webhook, Plus, Trash2, Play, ToggleLeft, ToggleRight, X, Link, Clock } from "lucide-react";

interface WebhookEntry {
  id: string;
  name: string;
  event_name: string;
  agent_codename: string;
  chain_template: string;
  active: boolean;
  last_triggered: string | null;
  trigger_count: number;
  created_at: string;
}

const EMPTY_FORM = {
  name: "",
  event_name: "generic",
  agent_codename: "jazper",
  chain_template: "",
  secret: "",
  active: true,
};

export default function WebhooksPanel() {
  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/webhooks");
      setWebhooks(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleCreate() {
    if (!form.name.trim() || !form.chain_template.trim()) return;
    setSaving(true);
    try {
      await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setForm(EMPTY_FORM);
      setShowCreate(false);
      load();
      showToast("Webhook created");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: string) {
    await fetch(`/api/webhooks/${id}/toggle`, { method: "PATCH" });
    load();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    load();
  }

  async function handleTest(id: string) {
    setTesting(id);
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
      const data = await res.json();
      showToast(data.ok ? "Test fired — chain running in background" : `Error: ${data.detail}`);
    } finally {
      setTesting(null);
      load();
    }
  }

  function inboundUrl(id: string) {
    return `${window.location.origin.replace("3000", "8000")}/api/webhooks/${id}/inbound`;
  }

  const fmtDate = (s: string | null) => s ? new Date(s).toLocaleString() : "Never";

  return (
    <div style={{ padding: 24, height: "100%", overflowY: "auto", background: "#0f0f13", color: "#e2e8f0" }}>
      {toast && (
        <div style={{ position: "fixed", top: 20, right: 20, background: "#1e1b2e", border: "1px solid #4f46e5",
          color: "#a78bfa", padding: "10px 18px", borderRadius: 8, fontSize: 13, zIndex: 9999 }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Webhook size={22} color="#f59e0b" />
          <span style={{ fontSize: 20, fontWeight: 700, color: "#f59e0b" }}>Webhooks</span>
          <span style={{ fontSize: 12, color: "#64748b", marginLeft: 4 }}>Inbound events that fire agent chains</span>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "#d97706", color: "#fff",
            border: "none", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontSize: 13 }}
        >
          <Plus size={14} /> New Webhook
        </button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{ background: "#1e1b2e", border: "1px solid #d97706", borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
            <span style={{ fontWeight: 600, color: "#f59e0b" }}>Create webhook</span>
            <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b" }}>
              <X size={16} />
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. github-push"
                style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
                  padding: "8px 12px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Event name</label>
              <input value={form.event_name} onChange={e => setForm(f => ({ ...f, event_name: e.target.value }))}
                placeholder="generic"
                style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
                  padding: "8px 12px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>Agent codename</label>
            <input value={form.agent_codename} onChange={e => setForm(f => ({ ...f, agent_codename: e.target.value }))}
              placeholder="jazper"
              style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
                padding: "8px 12px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>
              Chain template — use {"{key}"} for payload fields
            </label>
            <textarea value={form.chain_template} onChange={e => setForm(f => ({ ...f, chain_template: e.target.value }))}
              placeholder="Summarize this: {body.text} and then send the result to my email"
              rows={3}
              style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
                padding: "8px 12px", color: "#e2e8f0", fontSize: 13, resize: "vertical", boxSizing: "border-box" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: "#64748b", display: "block", marginBottom: 4 }}>
              Secret (HMAC-SHA256, optional)
            </label>
            <input value={form.secret} onChange={e => setForm(f => ({ ...f, secret: e.target.value }))}
              placeholder="Leave blank to skip signature verification"
              type="password"
              style={{ width: "100%", background: "#0f0f13", border: "1px solid #2d2d3a", borderRadius: 6,
                padding: "8px 12px", color: "#e2e8f0", fontSize: 13, boxSizing: "border-box" }} />
          </div>
          <button onClick={handleCreate} disabled={saving}
            style={{ background: "#d97706", color: "#fff", border: "none", borderRadius: 6,
              padding: "8px 18px", cursor: "pointer", fontSize: 13 }}>
            {saving ? "Creating…" : "Create Webhook"}
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div style={{ textAlign: "center", color: "#64748b", paddingTop: 40 }}>Loading…</div>
      ) : webhooks.length === 0 ? (
        <div style={{ textAlign: "center", color: "#64748b", paddingTop: 40 }}>No webhooks yet. Create one to let external events fire agent chains.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {webhooks.map(wh => (
            <div key={wh.id} style={{ background: "#1a1a24", border: "1px solid #2d2d3a", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14, color: "#e2e8f0" }}>{wh.name}</span>
                    <span style={{ background: wh.active ? "#052e16" : "#1a1a24",
                      color: wh.active ? "#4ade80" : "#64748b",
                      border: `1px solid ${wh.active ? "#166534" : "#374151"}`,
                      borderRadius: 4, padding: "1px 7px", fontSize: 11 }}>
                      {wh.active ? "active" : "paused"}
                    </span>
                    <span style={{ background: "#1e1b2e", color: "#f59e0b", borderRadius: 4,
                      padding: "1px 7px", fontSize: 11, border: "1px solid #854d0e" }}>
                      {wh.event_name}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 4 }}>
                    Agent: <strong style={{ color: "#e2e8f0" }}>{wh.agent_codename}</strong>
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55vw" }}>
                    {wh.chain_template}
                  </div>
                  {/* Inbound URL */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#64748b" }}>
                    <Link size={10} />
                    <code style={{ fontSize: 10, color: "#4f46e5", wordBreak: "break-all" }}>
                      POST {`/api/webhooks/${wh.id}/inbound`}
                    </code>
                    <button onClick={() => navigator.clipboard.writeText(inboundUrl(wh.id))}
                      style={{ background: "none", cursor: "pointer", color: "#64748b", fontSize: 10,
                        padding: "2px 6px", borderRadius: 3, border: "1px solid #2d2d3a" }}>
                      copy
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => handleTest(wh.id)}
                      disabled={testing === wh.id}
                      title="Fire test"
                      style={{ background: "#1e3a1e", color: "#4ade80", border: "1px solid #166534",
                        borderRadius: 6, padding: "5px 10px", cursor: "pointer", fontSize: 12,
                        display: "flex", alignItems: "center", gap: 4 }}>
                      <Play size={11} /> {testing === wh.id ? "Firing…" : "Test"}
                    </button>
                    <button onClick={() => handleToggle(wh.id)}
                      title={wh.active ? "Pause" : "Activate"}
                      style={{ background: "none", border: "1px solid #2d2d3a", borderRadius: 6,
                        padding: "5px 8px", cursor: "pointer", color: wh.active ? "#f59e0b" : "#64748b" }}>
                      {wh.active ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => handleDelete(wh.id)}
                      style={{ background: "none", border: "1px solid #2d2d3a", borderRadius: 6,
                        padding: "5px 8px", cursor: "pointer", color: "#dc2626" }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Clock size={10} /> Last: {fmtDate(wh.last_triggered)}
                    </div>
                    <div>Triggered {wh.trigger_count}×</div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
