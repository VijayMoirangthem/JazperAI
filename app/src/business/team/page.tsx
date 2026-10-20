"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/swr";
import { Loader2, Plus, Trash2, UserCog } from "lucide-react";

const API = "http://localhost:8000";

type MemberType = "employee" | "freelancer" | "intern" | "contractor";
type RateUnit = "hourly" | "daily" | "monthly" | "fixed";
type Status = "active" | "on_leave" | "inactive";

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  member_type: MemberType;
  rate: number;
  rate_unit: RateUnit;
  status: Status;
  start_date: string | null;
  end_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: string;
  title: string;
  client_id: string;
}

const MEMBER_TYPES: MemberType[] = ["employee", "freelancer", "intern", "contractor"];
const RATE_UNITS: RateUnit[] = ["hourly", "daily", "monthly", "fixed"];
const STATUSES: Status[] = ["active", "on_leave", "inactive"];

const RATE_UNIT_SUFFIX: Record<RateUnit, string> = {
  hourly: "/hr",
  daily: "/day",
  monthly: "/mo",
  fixed: " fixed",
};

function statusBadgeClass(status: Status) {
  if (status === "active") return "biz-badge biz-badge-success";
  if (status === "on_leave") return "biz-badge biz-badge-warning";
  return "biz-badge biz-badge-neutral";
}

function formatRate(rate: number, unit: RateUnit) {
  if (!rate) return null;
  return `$${rate.toLocaleString()}${RATE_UNIT_SUFFIX[unit]}`;
}

interface FormState {
  name: string;
  email: string;
  role: string;
  member_type: MemberType;
  rate: string;
  rate_unit: RateUnit;
  start_date: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  role: "",
  member_type: "employee",
  rate: "",
  rate_unit: "hourly",
  start_date: "",
  notes: "",
};

export default function TeamPage() {
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [adding, setAdding] = useState(false);

  const [typeFilter, setTypeFilter] = useState<MemberType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const [assignProjectId, setAssignProjectId] = useState("");
  const [assignRole, setAssignRole] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMsg, setAssignMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);

  const { data: members, refresh: refreshMembers, loading: membersLoading, error } = useApi<TeamMember[]>(`${API}/api/business/team`, { ttl: 10000, poll: 30000 });
  const { data: projects, refresh: refreshProjects, loading: projectsLoading } = useApi<Project[]>(`${API}/api/business/projects`, { ttl: 30000, poll: 30000 });

  const memberList = members ?? [];
  const projectList = projects ?? [];

  function toRateNumber(v: string) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function handleAdd() {
    if (!addForm.name.trim()) return;
    setAdding(true);
    try {
      const res = await fetch(`${API}/api/business/team`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: addForm.name,
          email: addForm.email,
          role: addForm.role,
          member_type: addForm.member_type,
          rate: toRateNumber(addForm.rate),
          rate_unit: addForm.rate_unit,
          start_date: addForm.start_date || undefined,
          notes: addForm.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`);
      setAddForm(EMPTY_FORM);
      setShowAddForm(false);
      await refreshMembers();
    } catch (e) {
      // error handled by useApi
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this team member? This cannot be undone.")) return;
    try {
      const res = await fetch(`${API}/api/business/team/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      if (expandedId === id) setExpandedId(null);
      await refreshMembers();
    } catch (e) {
      // error handled by useApi
    }
  }

  function toggleExpand(m: TeamMember) {
    if (expandedId === m.id) {
      setExpandedId(null);
      setEditForm(null);
      return;
    }
    setExpandedId(m.id);
    setEditForm({
      name: m.name,
      email: m.email,
      role: m.role,
      member_type: m.member_type,
      rate: m.rate ? String(m.rate) : "",
      rate_unit: m.rate_unit,
      start_date: m.start_date ? m.start_date.slice(0, 10) : "",
      notes: m.notes || "",
    });
    setAssignProjectId("");
    setAssignRole("");
    setAssignMsg(null);
  }

  async function handleSaveEdit(id: string) {
    if (!editForm) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`${API}/api/business/team/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editForm.name,
          email: editForm.email,
          role: editForm.role,
          member_type: editForm.member_type,
          rate: toRateNumber(editForm.rate),
          rate_unit: editForm.rate_unit,
          notes: editForm.notes,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`);
      await refreshMembers();
    } catch (e) {
      // error handled by useApi
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleStatusChange(id: string, status: Status) {
    try {
      const res = await fetch(`${API}/api/business/team/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refreshMembers();
    } catch (e) {
      // error handled by useApi
    }
  }

  async function handleAssign(id: string) {
    if (!assignProjectId) return;
    setAssigning(true);
    setAssignMsg(null);
    try {
      const res = await fetch(`${API}/api/business/team/${id}/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: assignProjectId, role_on_project: assignRole }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null))?.detail;
        throw new Error(detail || `HTTP ${res.status}`);
      }
      setAssignMsg({ id, text: "Assigned successfully.", ok: true });
      setAssignRole("");
    } catch (e) {
      setAssignMsg({ id, text: e instanceof Error ? e.message : "Failed to assign", ok: false });
    } finally {
      setAssigning(false);
    }
  }

  const filtered = memberList.filter(m => {
    if (typeFilter !== "all" && m.member_type !== typeFilter) return false;
    if (statusFilter !== "all" && m.status !== statusFilter) return false;
    return true;
  });

  const counts = MEMBER_TYPES.reduce<Record<MemberType, number>>((acc, t) => {
    acc[t] = memberList.filter(m => m.member_type === t).length;
    return acc;
  }, { employee: 0, freelancer: 0, intern: 0, contractor: 0 });

  return (
    <div className="biz-page">
      <div className="biz-page-header">
        <div>
          <h1 className="biz-page-title">Team</h1>
          <p className="biz-page-subtitle">Employees, freelancers, and contractors working on client projects.</p>
        </div>
        <button className="biz-btn biz-btn-primary" onClick={() => setShowAddForm(v => !v)}>
          <Plus size={14} /> Add Team Member
        </button>
      </div>

      <div className="biz-stat-grid">
        {MEMBER_TYPES.map(t => (
          <div className="biz-stat" key={t}>
            <p className="biz-stat-label">{t}s</p>
            <div className="biz-stat-value">{counts[t]}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="biz-card" style={{ marginBottom: 16, borderColor: "var(--biz-danger)", color: "var(--biz-danger)", fontSize: 13 }}>
          {error?.message}
        </div>
      )}

      {showAddForm && (
        <div className="biz-card" style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="biz-field-label">Name *</label>
              <input className="biz-input" value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} placeholder="Jane Doe" />
            </div>
            <div>
              <label className="biz-field-label">Email</label>
              <input className="biz-input" value={addForm.email} onChange={e => setAddForm({ ...addForm, email: e.target.value })} placeholder="jane@example.com" />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="biz-field-label">Role</label>
              <input className="biz-input" value={addForm.role} onChange={e => setAddForm({ ...addForm, role: e.target.value })} placeholder="Frontend Developer" />
            </div>
            <div>
              <label className="biz-field-label">Member Type</label>
              <select className="biz-select" value={addForm.member_type} onChange={e => setAddForm({ ...addForm, member_type: e.target.value as MemberType })}>
                {MEMBER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label className="biz-field-label">Rate</label>
              <input className="biz-input" type="number" value={addForm.rate} onChange={e => setAddForm({ ...addForm, rate: e.target.value })} placeholder="85" />
            </div>
            <div>
              <label className="biz-field-label">Rate Unit</label>
              <select className="biz-select" value={addForm.rate_unit} onChange={e => setAddForm({ ...addForm, rate_unit: e.target.value as RateUnit })}>
                {RATE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="biz-field-label">Start Date</label>
            <input className="biz-input" type="date" value={addForm.start_date} onChange={e => setAddForm({ ...addForm, start_date: e.target.value })} />
          </div>
          <div>
            <label className="biz-field-label">Notes</label>
            <textarea className="biz-textarea" rows={2} value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} />
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="biz-btn biz-btn-ghost" onClick={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}>Cancel</button>
            <button className="biz-btn biz-btn-primary" disabled={adding || !addForm.name.trim()} onClick={handleAdd}>
              {adding ? <Loader2 size={14} className="biz-spin" /> : <Plus size={14} />} Save
            </button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 20, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="biz-field-label" style={{ marginBottom: 0 }}>Type</span>
          <button className={`biz-btn biz-btn-sm ${typeFilter === "all" ? "biz-btn-primary" : "biz-btn-ghost"}`} onClick={() => setTypeFilter("all")}>All</button>
          {MEMBER_TYPES.map(t => (
            <button key={t} className={`biz-btn biz-btn-sm ${typeFilter === t ? "biz-btn-primary" : "biz-btn-ghost"}`} onClick={() => setTypeFilter(t)}>{t}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <span className="biz-field-label" style={{ marginBottom: 0 }}>Status</span>
          <button className={`biz-btn biz-btn-sm ${statusFilter === "all" ? "biz-btn-primary" : "biz-btn-ghost"}`} onClick={() => setStatusFilter("all")}>All</button>
          {STATUSES.map(s => (
            <button key={s} className={`biz-btn biz-btn-sm ${statusFilter === s ? "biz-btn-primary" : "biz-btn-ghost"}`} onClick={() => setStatusFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="biz-card" style={{ padding: 0 }}>
        {membersLoading && memberList.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--biz-text-muted)" }}>
            <Loader2 size={18} className="biz-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="biz-empty">
            <div className="biz-empty-icon"><UserCog size={34} style={{ margin: "0 auto" }} /></div>
            <p className="biz-empty-title">No team members yet</p>
            <p className="biz-empty-body">Add employees, freelancers, or contractors to start assigning them to client projects.</p>
          </div>
        ) : (
          <div className="biz-list">
            {filtered.map(m => {
              const rateStr = formatRate(m.rate, m.rate_unit);
              const expanded = expandedId === m.id;
              return (
                <div key={m.id}>
                  <div className="biz-row biz-row-hover" style={{ cursor: "pointer" }} onClick={() => toggleExpand(m)}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="biz-row-title">{m.name}{m.role ? ` — ${m.role}` : ""}</div>
                      <div className="biz-row-sub">{m.email || "no email"}{rateStr ? ` · ${rateStr}` : ""}</div>
                    </div>
                    <span className="biz-badge biz-badge-neutral">{m.member_type}</span>
                    <span className={statusBadgeClass(m.status)}>{m.status}</span>
                    <button
                      className="biz-btn biz-btn-icon biz-btn-danger-ghost"
                      onClick={e => { e.stopPropagation(); handleDelete(m.id); }}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {expanded && editForm && (
                    <div style={{ padding: "16px 18px 20px", borderBottom: "1px solid var(--biz-border)", background: "var(--biz-bg-elevated)" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label className="biz-field-label">Name</label>
                          <input className="biz-input" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
                        </div>
                        <div>
                          <label className="biz-field-label">Email</label>
                          <input className="biz-input" value={editForm.email} onChange={e => setEditForm({ ...editForm, email: e.target.value })} />
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label className="biz-field-label">Role</label>
                          <input className="biz-input" value={editForm.role} onChange={e => setEditForm({ ...editForm, role: e.target.value })} />
                        </div>
                        <div>
                          <label className="biz-field-label">Member Type</label>
                          <select className="biz-select" value={editForm.member_type} onChange={e => setEditForm({ ...editForm, member_type: e.target.value as MemberType })}>
                            {MEMBER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                        <div>
                          <label className="biz-field-label">Rate</label>
                          <input className="biz-input" type="number" value={editForm.rate} onChange={e => setEditForm({ ...editForm, rate: e.target.value })} />
                        </div>
                        <div>
                          <label className="biz-field-label">Rate Unit</label>
                          <select className="biz-select" value={editForm.rate_unit} onChange={e => setEditForm({ ...editForm, rate_unit: e.target.value as RateUnit })}>
                            {RATE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="biz-field-label">Status</label>
                          <select className="biz-select" value={m.status} onChange={e => handleStatusChange(m.id, e.target.value as Status)}>
                            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                      </div>
                      <div style={{ marginBottom: 12 }}>
                        <label className="biz-field-label">Notes</label>
                        <textarea className="biz-textarea" rows={2} value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 18 }}>
                        <button className="biz-btn biz-btn-primary biz-btn-sm" disabled={savingEdit} onClick={() => handleSaveEdit(m.id)}>
                          {savingEdit ? <Loader2 size={12} className="biz-spin" /> : null} Save Changes
                        </button>
                      </div>

                      <div style={{ borderTop: "1px solid var(--biz-border)", paddingTop: 14 }}>
                        <label className="biz-field-label">Assign to Project</label>
                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <select className="biz-select" style={{ flex: 2 }} value={assignProjectId} onChange={e => setAssignProjectId(e.target.value)}>
                            <option value="">Select a project…</option>
                            {projectList.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                          </select>
                          <input className="biz-input" style={{ flex: 1 }} placeholder="Role on project" value={assignRole} onChange={e => setAssignRole(e.target.value)} />
                          <button className="biz-btn biz-btn-sm" disabled={assigning || !assignProjectId} onClick={() => handleAssign(m.id)}>
                            {assigning ? <Loader2 size={12} className="biz-spin" /> : "Assign"}
                          </button>
                        </div>
                        {assignMsg && assignMsg.id === m.id && (
                          <p style={{ fontSize: 12, marginTop: 8, color: assignMsg.ok ? "var(--biz-success)" : "var(--biz-danger)" }}>
                            {assignMsg.text}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}