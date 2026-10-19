"use client";

import { useState, useEffect, useCallback } from "react";
import { Layers, Plus, Trash2, RefreshCw, Check, Loader2, ChevronDown, ChevronRight, TrendingUp } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

const API = "http://localhost:8000";

type SprintStatus = "active" | "completed" | "cancelled";
type TaskStatus   = "todo" | "in_progress" | "done";

interface SprintTask {
  id: string;
  title: string;
  status: TaskStatus;
  added_at: string;
}

interface Sprint {
  id: string;
  title: string;
  goal: string;
  start_date: string;
  end_date: string;
  status: SprintStatus;
  total_tasks: number;
  done_tasks: number;
  created_at: string;
}

interface Velocity {
  total_tasks: number;
  done_tasks: number;
  completion_rate: number;
  days_elapsed: number;
  days_remaining: number;
  projected_completion_rate: number;
}

const STATUS_META: Record<SprintStatus, { label: string; color: string }> = {
  active:    { label: "Active",    color: "#22c55e" },
  completed: { label: "Done",      color: "#6b7280" },
  cancelled: { label: "Cancelled", color: "#ef4444" },
};

const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string }> = {
  todo:        { label: "Todo",        color: "#6b7280" },
  in_progress: { label: "In Progress", color: "#f59e0b" },
  done:        { label: "Done",        color: "#22c55e" },
};

function fmtDate(d: string) {
  try { return new Date(d).toLocaleDateString([], { month: "short", day: "numeric" }); }
  catch { return d; }
}

function daysLeft(end: string) {
  const d = Math.round((new Date(end).getTime() - Date.now()) / 86400000);
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "ends today";
  return `${d}d left`;
}

export function SprintsPanel() {
  const toast = useToast();

  const [sprints, setSprints]       = useState<Sprint[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showAll, setShowAll]       = useState(false);
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());
  const [tasks, setTasks]           = useState<Record<string, SprintTask[]>>({});
  const [velocity, setVelocity]     = useState<Record<string, Velocity>>({});

  // New sprint form
  const [adding, setAdding]         = useState(false);
  const [newTitle, setNewTitle]     = useState("");
  const [newGoal, setNewGoal]       = useState("");
  const [newStart, setNewStart]     = useState(() => new Date().toISOString().slice(0, 10));
  const [newEnd, setNewEnd]         = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10);
  });
  const [saving, setSaving]         = useState(false);

  // New task form per sprint
  const [addingTask, setAddingTask] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [taskSaving, setTaskSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/sprints?status=${showAll ? "all" : "active"}`);
      if (res.ok) setSprints((await res.json()).sprints || []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [showAll]);

  useEffect(() => { load(); }, [load]);

  async function loadTasks(sprintId: string) {
    try {
      const [tRes, vRes] = await Promise.all([
        fetch(`${API}/api/sprints/${sprintId}/tasks`),
        fetch(`${API}/api/sprints/${sprintId}/velocity`),
      ]);
      if (tRes.ok) { const td = await tRes.json(); setTasks(prev => ({ ...prev, [sprintId]: td.tasks || [] })); }
      if (vRes.ok) { const vd = await vRes.json(); setVelocity(prev => ({ ...prev, [sprintId]: vd })); }
    } catch { /* silent */ }
  }

  function toggleExpand(id: string) {
    const isOpening = !expanded.has(id);
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    if (isOpening) loadTasks(id);
  }

  async function createSprint() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/api/sprints`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, goal: newGoal, start_date: newStart, end_date: newEnd }),
      });
      if (!res.ok) throw new Error();
      toast("Sprint created", "success");
      setAdding(false); setNewTitle(""); setNewGoal("");
      load();
    } catch { toast("Failed to create sprint", "error"); } finally { setSaving(false); }
  }

  async function deleteSprint(id: string) {
    setSprints(prev => prev.filter(s => s.id !== id));
    try { await fetch(`${API}/api/sprints/${id}`, { method: "DELETE" }); }
    catch { load(); }
  }

  async function addTask(sprintId: string) {
    if (!newTaskTitle.trim()) return;
    setTaskSaving(true);
    try {
      const res = await fetch(`${API}/api/sprints/${sprintId}/tasks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTaskTitle }),
      });
      if (!res.ok) throw new Error();
      setAddingTask(null); setNewTaskTitle("");
      loadTasks(sprintId);
      load();
    } catch { toast("Failed to add task", "error"); } finally { setTaskSaving(false); }
  }

  async function updateTaskStatus(sprintId: string, taskId: string, status: TaskStatus) {
    setTasks(prev => ({
      ...prev,
      [sprintId]: (prev[sprintId] || []).map(t => t.id === taskId ? { ...t, status } : t),
    }));
    try {
      await fetch(`${API}/api/sprints/${sprintId}/tasks/${taskId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      loadTasks(sprintId);
      load();
    } catch { loadTasks(sprintId); }
  }

  async function deleteTask(sprintId: string, taskId: string) {
    setTasks(prev => ({ ...prev, [sprintId]: (prev[sprintId] || []).filter(t => t.id !== taskId) }));
    try { await fetch(`${API}/api/sprints/${sprintId}/tasks/${taskId}`, { method: "DELETE" }); }
    catch { loadTasks(sprintId); }
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Layers size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Sprint Planner</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
          <button onClick={() => setShowAll(s => !s)} style={{ fontSize: 11, color: "var(--color-text-muted)", background: "none", border: "none", cursor: "pointer" }}>
            {showAll ? "Active only" : "All sprints"}
          </button>
          <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-icon)", display: "flex" }}>
            <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
          </button>
          <button
            onClick={() => setAdding(a => !a)}
            style={{ padding: "3px 10px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={11} /> New Sprint
          </button>
        </div>
      </div>

      {/* New sprint form */}
      {adding && (
        <div style={{ padding: "var(--sp-3)", borderBottom: "var(--border)", background: "var(--color-surface-raised)", display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
          <input className="sj-input" placeholder="Sprint name  (e.g. Week 30 — Job Hunt)" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus style={{ fontSize: 13 }} />
          <input className="sj-input" placeholder="Sprint goal  (optional)" value={newGoal} onChange={e => setNewGoal(e.target.value)} style={{ fontSize: 12 }} />
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>Start</span>
              <input type="date" className="sj-input" value={newStart} onChange={e => setNewStart(e.target.value)} style={{ fontSize: 12 }} />
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>End</span>
              <input type="date" className="sj-input" value={newEnd} onChange={e => setNewEnd(e.target.value)} style={{ fontSize: 12 }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <button onClick={createSprint} disabled={saving || !newTitle.trim()} style={{ flex: 1, padding: "6px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 12, cursor: "pointer", opacity: !newTitle.trim() ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
              {saving ? <Loader2 size={12} className="sj-spin" /> : <Check size={12} />} Create Sprint
            </button>
            <button onClick={() => setAdding(false)} style={{ padding: "6px 14px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 12, cursor: "pointer", color: "var(--color-text-muted)" }}>Cancel</button>
          </div>
        </div>
      )}

      <div className="sj-panel-body" style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)" }}>Loading…</p>
        ) : sprints.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)" }}>
            <div style={{ fontSize: 40, marginBottom: "var(--sp-3)" }}>🏃</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>No sprints yet. Create your first weekly sprint above.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {sprints.map(sprint => {
              const isOpen  = expanded.has(sprint.id);
              const spTasks = tasks[sprint.id] || [];
              const vel     = velocity[sprint.id];
              const progress = sprint.total_tasks > 0 ? (sprint.done_tasks / sprint.total_tasks) * 100 : 0;

              return (
                <div key={sprint.id} style={{ borderBottom: "1px solid var(--color-border-lo)" }}>
                  {/* Sprint header */}
                  <div onClick={() => toggleExpand(sprint.id)} style={{ padding: "var(--sp-3)", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "var(--sp-2)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: "var(--sp-1)" }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>{sprint.title}</span>
                        <span style={{ fontSize: 9, padding: "1px 7px", borderRadius: "var(--r-full)", background: `${STATUS_META[sprint.status]?.color || "#6b7280"}18`, border: `1px solid ${STATUS_META[sprint.status]?.color || "#6b7280"}44`, color: STATUS_META[sprint.status]?.color || "#6b7280", fontWeight: 700 }}>
                          {STATUS_META[sprint.status]?.label}
                        </span>
                      </div>

                      {sprint.goal && <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: "0 0 var(--sp-1)" }}>{sprint.goal}</p>}

                      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)", flexWrap: "wrap" }}>
                        <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                          {fmtDate(sprint.start_date)} → {fmtDate(sprint.end_date)}
                        </span>
                        {sprint.status === "active" && (
                          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>· {daysLeft(sprint.end_date)}</span>
                        )}
                        <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)" }}>
                          {sprint.done_tasks}/{sprint.total_tasks} tasks
                        </span>
                      </div>

                      {sprint.total_tasks > 0 && (
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginTop: "var(--sp-1)" }}>
                          <div style={{ flex: 1, height: 4, background: "var(--color-surface-raised)", borderRadius: "var(--r-full)", overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${progress}%`, background: STATUS_META[sprint.status]?.color || "#22c55e", borderRadius: "var(--r-full)", transition: "width 0.4s" }} />
                          </div>
                          <span style={{ fontSize: 10, color: "var(--color-text-muted)", fontFamily: "var(--font-mono)", width: 30 }}>{Math.round(progress)}%</span>
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "var(--sp-1)", alignItems: "center", flexShrink: 0 }}>
                      <button onClick={e => { e.stopPropagation(); deleteSprint(sprint.id); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                        <Trash2 size={11} />
                      </button>
                      {isOpen ? <ChevronDown size={12} style={{ color: "var(--color-icon)" }} /> : <ChevronRight size={12} style={{ color: "var(--color-icon)" }} />}
                    </div>
                  </div>

                  {/* Expanded: tasks + velocity */}
                  {isOpen && (
                    <div style={{ paddingLeft: "var(--sp-4)", paddingRight: "var(--sp-3)", paddingBottom: "var(--sp-3)" }}>
                      {/* Velocity card */}
                      {vel && (
                        <div style={{ display: "flex", gap: "var(--sp-3)", padding: "var(--sp-2)", borderRadius: "var(--r-sm)", background: "var(--color-surface-raised)", marginBottom: "var(--sp-2)", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <TrendingUp size={11} style={{ color: "var(--color-accent)" }} />
                            <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                              <strong style={{ color: "var(--color-text)" }}>{vel.completion_rate.toFixed(0)}%</strong> done ·
                              {vel.days_remaining > 0 && <> projected <strong style={{ color: vel.projected_completion_rate >= 80 ? "#22c55e" : "#f59e0b" }}>{vel.projected_completion_rate.toFixed(0)}%</strong></>}
                              {vel.days_remaining <= 0 ? " · sprint ended" : ` · ${vel.days_remaining}d left`}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Task list */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)", marginBottom: "var(--sp-2)" }}>
                        {spTasks.length === 0 && <p style={{ fontSize: 11, color: "var(--color-text-muted)" }}>No tasks yet.</p>}
                        {spTasks.map(task => (
                          <div key={task.id} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                            <button
                              onClick={() => updateTaskStatus(sprint.id, task.id, task.status === "done" ? "todo" : "done")}
                              style={{ width: 14, height: 14, borderRadius: "var(--r-sm)", border: task.status === "done" ? "none" : "var(--border)", background: task.status === "done" ? "#22c55e" : "var(--color-surface-raised)", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}
                            >
                              {task.status === "done" && <Check size={8} color="#fff" />}
                            </button>
                            <span style={{ flex: 1, fontSize: 12, color: task.status === "done" ? "var(--color-text-muted)" : "var(--color-text)", textDecoration: task.status === "done" ? "line-through" : "none" }}>
                              {task.title}
                            </span>
                            {task.status !== "done" && (
                              <button
                                onClick={() => updateTaskStatus(sprint.id, task.id, task.status === "in_progress" ? "todo" : "in_progress")}
                                style={{ fontSize: 9, padding: "1px 6px", borderRadius: "var(--r-full)", border: task.status === "in_progress" ? `1px solid #f59e0b44` : "var(--border)", background: task.status === "in_progress" ? "#f59e0b18" : "none", color: task.status === "in_progress" ? "#f59e0b" : "var(--color-text-muted)", cursor: "pointer" }}
                              >
                                {task.status === "in_progress" ? "▶ In progress" : "▷ Start"}
                              </button>
                            )}
                            <button onClick={() => deleteTask(sprint.id, task.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", display: "flex" }}>
                              <Trash2 size={10} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* Add task */}
                      {addingTask === sprint.id ? (
                        <div style={{ display: "flex", gap: "var(--sp-1)" }}>
                          <input className="sj-input" placeholder="Task title" value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} autoFocus style={{ flex: 1, fontSize: 12 }} onKeyDown={e => { if (e.key === "Enter") addTask(sprint.id); if (e.key === "Escape") setAddingTask(null); }} />
                          <button onClick={() => addTask(sprint.id)} disabled={taskSaving || !newTaskTitle.trim()} style={{ padding: "4px 8px", borderRadius: "var(--r-sm)", border: "none", background: "var(--color-accent)", color: "#fff", fontSize: 11, cursor: "pointer" }}>
                            {taskSaving ? <Loader2 size={10} className="sj-spin" /> : <Check size={10} />}
                          </button>
                          <button onClick={() => setAddingTask(null)} style={{ padding: "4px 8px", borderRadius: "var(--r-sm)", border: "var(--border)", background: "none", fontSize: 11, cursor: "pointer", color: "var(--color-text-muted)" }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={() => { setAddingTask(sprint.id); setNewTaskTitle(""); }} style={{ fontSize: 11, color: "var(--color-accent)", background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 3 }}>
                          <Plus size={10} /> Add task to sprint
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
