"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/swr";
import { Loader2, Pencil, Trash2, Users } from "lucide-react";

const API = "http://localhost:8000";

type ClientStatus = "prospect" | "active" | "paused" | "churned";

interface Client {
  id: string;
  name: string;
  contact_name: string;
  contact_email: string;
  phone: string;
  status: ClientStatus;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface ClientFormState {
  name: string;
  contact_name: string;
  contact_email: string;
  phone: string;
  notes: string;
}

const EMPTY_FORM: ClientFormState = {
  name: "",
  contact_name: "",
  contact_email: "",
  phone: "",
  notes: "",
};

const STATUS_FILTERS: Array<{ value: "all" | ClientStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "churned", label: "Churned" },
];

function statusBadgeClass(status: ClientStatus): string {
  switch (status) {
    case "active":
      return "biz-badge biz-badge-success";
    case "paused":
      return "biz-badge biz-badge-warning";
    case "churned":
      return "biz-badge biz-badge-danger";
    default:
      return "biz-badge biz-badge-neutral";
  }
}

export default function ClientsPage() {
  const [filter, setFilter] = useState<"all" | ClientStatus>("all");

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ClientFormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ClientFormState>(EMPTY_FORM);
  const [editStatus, setEditStatus] = useState<ClientStatus>("prospect");
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: clients, refresh, loading, error: loadError } = useApi<Client[]>(`${API}/api/business/clients`, { ttl: 10000, poll: 30000 });
  const clientList = clients ?? [];

  const counts = {
    prospect: clientList.filter(c => c.status === "prospect").length,
    active: clientList.filter(c => c.status === "active").length,
    paused: clientList.filter(c => c.status === "paused").length,
    churned: clientList.filter(c => c.status === "churned").length,
  };

  const filtered = filter === "all" ? clientList : clientList.filter(c => c.status === filter);

  function openCreate() {
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setShowCreate(true);
    setEditingId(null);
  }

  async function submitCreate() {
    if (!createForm.name.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${API}/api/business/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      await refresh();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create client");
    } finally {
      setCreating(false);
    }
  }

  function openEdit(c: Client) {
    setEditingId(c.id);
    setEditForm({
      name: c.name,
      contact_name: c.contact_name || "",
      contact_email: c.contact_email || "",
      phone: c.phone || "",
      notes: c.notes || "",
    });
    setEditStatus(c.status);
    setEditError(null);
    setShowCreate(false);
  }

  async function submitEdit() {
    if (!editingId || !editForm.name.trim() || saving) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`${API}/api/business/clients/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editForm, status: editStatus }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEditingId(null);
      await refresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "Failed to save client");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this client? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/api/business/clients/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (e) {
      console.error("Failed to delete client", e);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="biz-page">
      <div className="biz-page-header">
        <div>
          <h1 className="biz-page-title">Clients</h1>
          <p className="biz-page-subtitle">Every company and contact COOS is working with.</p>
        </div>
        <button className="biz-btn biz-btn-primary" onClick={openCreate}>
          + New Client
        </button>
      </div>

      <div className="biz-stat-grid">
        <div className="biz-stat">
          <p className="biz-stat-label">Prospect</p>
          <div className="biz-stat-value">{counts.prospect}</div>
        </div>
        <div className="biz-stat">
          <p className="biz-stat-label">Active</p>
          <div className="biz-stat-value">{counts.active}</div>
        </div>
        <div className="biz-stat">
          <p className="biz-stat-label">Paused</p>
          <div className="biz-stat-value">{counts.paused}</div>
        </div>
        <div className="biz-stat">
          <p className="biz-stat-label">Churned</p>
          <div className="biz-stat-value">{counts.churned}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`biz-badge ${filter === f.value ? "biz-badge-accent" : "biz-badge-neutral"}`}
            style={{ cursor: "pointer", border: "none" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {showCreate && (
        <div className="biz-card" style={{ marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div>
              <label className="biz-field-label">Name *</label>
              <input
                className="biz-input"
                value={createForm.name}
                onChange={e => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="Acme Corp"
              />
            </div>
            <div>
              <label className="biz-field-label">Contact Name</label>
              <input
                className="biz-input"
                value={createForm.contact_name}
                onChange={e => setCreateForm({ ...createForm, contact_name: e.target.value })}
                placeholder="Jane Doe"
              />
            </div>
            <div>
              <label className="biz-field-label">Contact Email</label>
              <input
                className="biz-input"
                value={createForm.contact_email}
                onChange={e => setCreateForm({ ...createForm, contact_email: e.target.value })}
                placeholder="jane@acme.com"
              />
            </div>
            <div>
              <label className="biz-field-label">Phone</label>
              <input
                className="biz-input"
                value={createForm.phone}
                onChange={e => setCreateForm({ ...createForm, phone: e.target.value })}
                placeholder="+1 555 0100"
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label className="biz-field-label">Notes</label>
              <textarea
                className="biz-textarea"
                rows={3}
                value={createForm.notes}
                onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
              />
            </div>
          </div>

          {createError && (
            <p style={{ color: "var(--biz-danger)", fontSize: 12, marginTop: 12 }}>{createError}</p>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <button className="biz-btn biz-btn-ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
            <button
              className="biz-btn biz-btn-primary"
              onClick={submitCreate}
              disabled={creating || !createForm.name.trim()}
            >
              {creating ? <Loader2 size={14} className="biz-spin" /> : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="biz-card" style={{ padding: 0 }}>
        {loading && clientList.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--biz-text-muted)" }}>
            <Loader2 size={18} className="biz-spin" />
          </div>
        ) : loadError ? (
          <div className="biz-empty">
            <div className="biz-empty-icon">!</div>
            <p className="biz-empty-title">Could not load clients</p>
            <p className="biz-empty-body">{loadError?.message}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="biz-empty">
            <div className="biz-empty-icon">
              <Users size={34} style={{ opacity: 0.6 }} />
            </div>
            <p className="biz-empty-title">
              {clientList.length === 0 ? "No clients yet" : "No clients match this filter"}
            </p>
            <p className="biz-empty-body">
              {clientList.length === 0
                ? "Add your first client to start tracking work for them."
                : "Try a different status filter, or add a new client."}
            </p>
          </div>
        ) : (
          <div className="biz-list">
            {filtered.map(c => (
              <div key={c.id}>
                <div className="biz-row biz-row-hover">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="biz-row-title">{c.name}</div>
                    <div className="biz-row-sub">
                      {[c.contact_name, c.contact_email].filter(Boolean).join(" · ") || "No contact on file"}
                    </div>
                  </div>
                  <span className={statusBadgeClass(c.status)}>{c.status}</span>
                  <button className="biz-btn biz-btn-icon biz-btn-ghost" onClick={() => openEdit(c)} title="Edit">
                    <Pencil size={14} />
                  </button>
                  <button
                    className="biz-btn biz-btn-icon biz-btn-danger-ghost"
                    onClick={() => handleDelete(c.id)}
                    disabled={deletingId === c.id}
                    title="Delete"
                  >
                    {deletingId === c.id ? <Loader2 size={14} className="biz-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>

                {editingId === c.id && (
                  <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--biz-border)", background: "var(--biz-bg-elevated)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <div>
                        <label className="biz-field-label">Name *</label>
                        <input
                          className="biz-input"
                          value={editForm.name}
                          onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="biz-field-label">Status</label>
                        <select
                          className="biz-select"
                          value={editStatus}
                          onChange={e => setEditStatus(e.target.value as ClientStatus)}
                        >
                          <option value="prospect">Prospect</option>
                          <option value="active">Active</option>
                          <option value="paused">Paused</option>
                          <option value="churned">Churned</option>
                        </select>
                      </div>
                      <div>
                        <label className="biz-field-label">Contact Name</label>
                        <input
                          className="biz-input"
                          value={editForm.contact_name}
                          onChange={e => setEditForm({ ...editForm, contact_name: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="biz-field-label">Contact Email</label>
                        <input
                          className="biz-input"
                          value={editForm.contact_email}
                          onChange={e => setEditForm({ ...editForm, contact_email: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="biz-field-label">Phone</label>
                        <input
                          className="biz-input"
                          value={editForm.phone}
                          onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                        />
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label className="biz-field-label">Notes</label>
                        <textarea
                          className="biz-textarea"
                          rows={3}
                          value={editForm.notes}
                          onChange={e => setEditForm({ ...editForm, notes: e.target.value })}
                        />
                      </div>
                    </div>

                    {editError && (
                      <p style={{ color: "var(--biz-danger)", fontSize: 12, marginTop: 12 }}>{editError}</p>
                    )}

                    <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
                      <button className="biz-btn biz-btn-ghost" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                      <button
                        className="biz-btn biz-btn-primary"
                        onClick={submitEdit}
                        disabled={saving || !editForm.name.trim()}
                      >
                        {saving ? <Loader2 size={14} className="biz-spin" /> : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}