"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/swr";
import { ChevronDown, ChevronRight, FolderKanban, Loader2, Trash2 } from "lucide-react";

const API = "http://localhost:8000";

type ProjectStatus = "planning" | "active" | "on_hold" | "completed" | "cancelled";

interface Client {
  id: string;
  name: string;
}

interface Project {
  id: string;
  client_id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  start_date: string | null;
  due_date: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface Assignment {
  id: string;
  project_id: string;
  team_member_id: string;
  role_on_project?: string;
  member_name?: string;
  member_email?: string;
  member_role?: string;
}

interface ProjectFormState {
  client_id: string;
  title: string;
  description: string;
  start_date: string;
  due_date: string;
  notes: string;
}

const EMPTY_FORM: ProjectFormState = {
  client_id: "",
  title: "",
  description: "",
  start_date: "",
  due_date: "",
  notes: "",
};

const STATUS_FILTERS: Array<{ value: "all" | ProjectStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "on_hold", label: "On Hold" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];

function statusBadgeClass(status: ProjectStatus): string {
  switch (status) {
    case "active":
      return "biz-badge biz-badge-accent";
    case "on_hold":
      return "biz-badge biz-badge-warning";
    case "completed":
      return "biz-badge biz-badge-success";
    case "cancelled":
      return "biz-badge biz-badge-danger";
    default:
      return "biz-badge biz-badge-neutral";
  }
}

function formatDueDate(dueDate: string | null): string | null {
  if (!dueDate) return null;
  try {
    const d = new Date(dueDate);
    if (Number.isNaN(d.getTime())) return null;
    return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  } catch {
    return null;
  }
}

export default function ProjectsPage() {
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | ProjectStatus>("all");

  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ProjectFormState>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [team, setTeam] = useState<Assignment[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: clients, refresh: refreshClients, loading: clientsLoading } = useApi<Client[]>(`${API}/api/business/clients`, { ttl: 30000, poll: 30000 });
  const { data: projects, refresh: refreshProjects, loading: projectsLoading, error: loadError } = useApi<Project[]>(`${API}/api/business/projects`, { ttl: 10000, poll: 30000 });

  const clientList = clients ?? [];
  const projectList = projects ?? [];

  const clientMap = new Map(clientList.map(c => [c.id, c.name]));

  const filtered = projectList.filter(p => {
    if (clientFilter !== "all" && p.client_id !== clientFilter) return false;
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    return true;
  });

  async function loadAll() {
    await Promise.all([refreshClients(), refreshProjects()]);
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openCreate() {
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setShowCreate(true);
    setExpandedId(null);
  }

  async function submitCreate() {
    if (!createForm.client_id || !createForm.title.trim() || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const body: Record<string, string> = {
        client_id: createForm.client_id,
        title: createForm.title,
        description: createForm.description,
        notes: createForm.notes,
      };
      if (createForm.start_date) body.start_date = createForm.start_date;
      if (createForm.due_date) body.due_date = createForm.due_date;

      const res = await fetch(`${API}/api/business/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setShowCreate(false);
      setCreateForm(EMPTY_FORM);
      await loadAll();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  async function toggleExpand(p: Project) {
    if (expandedId === p.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(p.id);
    setShowCreate(false);
    setTeam([]);
    setTeamError(null);
    setTeamLoading(true);
    try {
      const res = await fetch(`${API}/api/business/projects/${p.id}/team`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTeam(Array.isArray(data) ? data : []);
    } catch (e) {
      setTeamError(e instanceof Error ? e.message : "Could not load team");
    } finally {
      setTeamLoading(false);
    }
  }

  async function changeStatus(projectId: string, status: ProjectStatus) {
    setStatusUpdating(true);
    try {
      const res = await fetch(`${API}/api/business/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadAll();
    } catch (e) {
      console.error("Failed to update project status", e);
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this project? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API}/api/business/projects/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`);
      if (expandedId === id) setExpandedId(null);
      await loadAll();
    } catch (e) {
      console.error("Failed to delete project", e);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="biz-page">
      <div className="biz-page-header">
        <div>
          <h1 className="biz-page-title">Projects</h1>
          <p className="biz-page-subtitle">Every engagement COOS is running for a client.</p>
        </div>
        <button className="biz-btn biz-btn-primary" onClick={openCreate}>
          + New Project
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <select
          className="biz-select"
          style={{ width: "auto", minWidth: 180 }}
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
        >
          <option value="all">All Clients</option>
          {clientList.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`biz-badge ${statusFilter === f.value ? "biz-badge-accent" : "biz-badge-neutral"}`}
              style={{ cursor: "pointer", border: "none" }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {showCreate && (
        <div className="biz-card" style={{ marginBottom: 20 }}>
          {clientList.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--biz-text-muted)" }}>
              No clients yet — add one on the Clients page first.
            </p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <label className="biz-field-label">Client *</label>
                <select
                  className="biz-select"
                  value={createForm.client_id}
                  onChange={e => setCreateForm({ ...createForm, client_id: e.target.value })}
                >
                  <option value="">Select a client…</option>
                  {clientList.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="biz-field-label">Title *</label>
                <input
                  className="biz-input"
                  value={createForm.title}
                  onChange={e => setCreateForm({ ...createForm, title: e.target.value })}
                  placeholder="Website Redesign"
                />
              </div>
              <div>
                <label className="biz-field-label">Start Date</label>
                <input
                  type="date"
                  className="biz-input"
                  value={createForm.start_date}
                  onChange={e => setCreateForm({ ...createForm, start_date: e.target.value })}
                />
              </div>
              <div>
                <label className="biz-field-label">Due Date</label>
                <input
                  type="date"
                  className="biz-input"
                  value={createForm.due_date}
                  onChange={e => setCreateForm({ ...createForm, due_date: e.target.value })}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="biz-field-label">Description</label>
                <textarea
                  className="biz-textarea"
                  rows={2}
                  value={createForm.description}
                  onChange={e => setCreateForm({ ...createForm, description: e.target.value })}
                />
              </div>
              <div style={{ gridColumn: "1 / -1" }}>
                <label className="biz-field-label">Notes</label>
                <textarea
                  className="biz-textarea"
                  rows={2}
                  value={createForm.notes}
                  onChange={e => setCreateForm({ ...createForm, notes: e.target.value })}
                />
              </div>
            </div>
          )}

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
              disabled={creating || clientList.length === 0 || !createForm.client_id || !createForm.title.trim()}
            >
              {creating ? <Loader2 size={14} className="biz-spin" /> : "Save"}
            </button>
          </div>
        </div>
      )}

      <div className="biz-card" style={{ padding: 0 }}>
        {(clientsLoading || projectsLoading) && projectList.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--biz-text-muted)" }}>
            <Loader2 size={18} className="biz-spin" />
          </div>
        ) : loadError ? (
          <div className="biz-empty">
            <div className="biz-empty-icon">!</div>
            <p className="biz-empty-title">Could not load projects</p>
            <p className="biz-empty-body">{loadError?.message}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="biz-empty">
            <div className="biz-empty-icon">
              <FolderKanban size={34} style={{ opacity: 0.6 }} />
            </div>
            <p className="biz-empty-title">
              {projectList.length === 0 ? "No projects yet" : "No projects match these filters"}
            </p>
            <p className="biz-empty-body">
              {projectList.length === 0
                ? "Add your first project to start tracking work."
                : "Try a different client or status filter, or add a new project."}
            </p>
          </div>
        ) : (
          <div className="biz-list">
            {filtered.map(p => {
              const due = formatDueDate(p.due_date);
              const sub = [clientMap.get(p.client_id) || "Unknown client", due].filter(Boolean).join(" · ");
              const isExpanded = expandedId === p.id;
              return (
                <div key={p.id}>
                  <div className="biz-row biz-row-hover" style={{ cursor: "pointer" }} onClick={() => toggleExpand(p)}>
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="biz-row-title">{p.title}</div>
                      <div className="biz-row-sub">{sub}</div>
                    </div>
                    <span className={statusBadgeClass(p.status)}>{p.status.replace("_", " ")}</span>
                    <button
                      className="biz-btn biz-btn-icon biz-btn-danger-ghost"
                      onClick={e => {
                        e.stopPropagation();
                        handleDelete(p.id);
                      }}
                      disabled={deletingId === p.id}
                      title="Delete"
                    >
                      {deletingId === p.id ? <Loader2 size={14} className="biz-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--biz-border)", background: "var(--biz-bg-elevated)" }}>
                      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 220 }}>
                          <label className="biz-field-label">Description</label>
                          <p style={{ fontSize: 13, color: "var(--biz-text-muted)", marginTop: 0, marginBottom: 12 }}>
                            {p.description || "—"}
                          </p>
                          <label className="biz-field-label">Notes</label>
                          <p style={{ fontSize: 13, color: "var(--biz-text-muted)", marginTop: 0 }}>
                            {p.notes || "—"}
                          </p>
                        </div>

                        <div style={{ minWidth: 200 }}>
                          <label className="biz-field-label">Status</label>
                          <select
                            className="biz-select"
                            value={p.status}
                            disabled={statusUpdating}
                            onChange={e => changeStatus(p.id, e.target.value as ProjectStatus)}
                            style={{ marginBottom: 16 }}
                          >
                            <option value="planning">Planning</option>
                            <option value="active">Active</option>
                            <option value="on_hold">On Hold</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                          </select>

                          <label className="biz-field-label">Team</label>
                          {teamLoading ? (
                            <Loader2 size={14} className="biz-spin" />
                          ) : teamError ? (
                            <p style={{ fontSize: 12, color: "var(--biz-text-faint)" }}>Could not load team</p>
                          ) : team.length === 0 ? (
                            <p style={{ fontSize: 12, color: "var(--biz-text-faint)" }}>No team members assigned</p>
                          ) : (
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {team.map(a => (
                                <span key={a.id} className="biz-badge biz-badge-neutral">
                                  {a.member_name || "Unknown"}
                                  {a.member_role ? ` (${a.member_role})` : ""}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
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