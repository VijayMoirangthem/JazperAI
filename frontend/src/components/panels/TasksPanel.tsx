"use client";

import { useState, useEffect, useRef } from "react";
import { ListTodo, Plus, Trash2, ChevronRight, Calendar } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Task {
  id: string;
  title: string;
  notes: string;
  priority: "low" | "medium" | "high";
  status: "pending" | "in_progress" | "done";
  due_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const PRIORITY_COLORS: Record<Task["priority"], string> = {
  low:    "var(--color-icon)",
  medium: "#e2a94b",
  high:   "#e25c5c",
};

const STATUS_CYCLE: Record<Task["status"], Task["status"]> = {
  pending:     "in_progress",
  in_progress: "done",
  done:        "pending",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  pending:     "Pending",
  in_progress: "In Progress",
  done:        "Done",
};

function formatDue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due   = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff  = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (diff < 0)  return `${Math.abs(diff)}d overdue`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function isDueOverdue(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso) < new Date();
}

export function TasksPanel() {
  const [tasks, setTasks]       = useState<Task[]>([]);
  const [loading, setLoading]   = useState(true);
  const [title, setTitle]       = useState("");
  const [notes, setNotes]       = useState("");
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [dueAt, setDueAt]       = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter]     = useState<"all" | Task["status"]>("all");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/tasks/`);
      const data = await res.json();
      setTasks(data.tasks ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }

  async function createTask() {
    const t = title.trim();
    if (!t || creating) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/api/tasks/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: t, notes, priority, due_at: dueAt || null }),
      });
      const task = await res.json();
      setTasks((prev) => [task, ...prev]);
      setTitle(""); setNotes(""); setDueAt(""); setPriority("medium");
      inputRef.current?.focus();
    } catch { /* ignore */ }
    setCreating(false);
  }

  async function cycleStatus(task: Task) {
    const next = STATUS_CYCLE[task.status];
    try {
      const res = await fetch(`${API}/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const updated = await res.json();
      setTasks((prev) => prev.map((t) => t.id === task.id ? updated : t));
    } catch { /* ignore */ }
  }

  async function deleteTask(id: string) {
    try {
      await fetch(`${API}/api/tasks/${id}`, { method: "DELETE" });
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (expanded === id) setExpanded(null);
    } catch { /* ignore */ }
  }

  const visible = filter === "all" ? tasks : tasks.filter((t) => t.status === filter);
  const counts = {
    all:        tasks.length,
    pending:    tasks.filter((t) => t.status === "pending").length,
    in_progress:tasks.filter((t) => t.status === "in_progress").length,
    done:       tasks.filter((t) => t.status === "done").length,
  };

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <ListTodo size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Tasks</span>
        <span className="sj-badge sj-ml-auto">{tasks.length}</span>
      </div>

      <div className="sj-panel-body sj-flex-col sj-gap-3" style={{ flex: 1, overflowY: "auto" }}>

        {/* Create form */}
        <div className="sj-card sj-flex-col sj-gap-2">
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center" }}>
            <Plus size={12} style={{ color: "var(--color-icon)", flexShrink: 0 }} />
            <input
              ref={inputRef}
              placeholder="New task title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createTask()}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: "flex", gap: "var(--sp-2)", alignItems: "center", paddingLeft: 20 }}>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as Task["priority"])}
              style={{ fontSize: 11, padding: "2px 6px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 4, color: PRIORITY_COLORS[priority] }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              style={{ fontSize: 11, padding: "2px 6px", background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderRadius: 4, color: "var(--color-text-muted)" }}
            />
            <button
              className="sj-btn sj-btn-primary"
              onClick={createTask}
              disabled={!title.trim() || creating}
              style={{ padding: "3px 10px", marginLeft: "auto", opacity: !title.trim() ? 0.4 : 1 }}
            >
              {creating ? "..." : "Add"}
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "var(--sp-1)" }}>
          {(["all", "pending", "in_progress", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid var(--color-border)",
                background: filter === f ? "var(--color-accent)" : "var(--color-surface-2)",
                color: filter === f ? "#fff" : "var(--color-text-muted)", cursor: "pointer",
              }}
            >
              {f === "all" ? "All" : f === "in_progress" ? "In Progress" : f.charAt(0).toUpperCase() + f.slice(1)}
              <span style={{ marginLeft: 4, opacity: 0.7 }}>{counts[f]}</span>
            </button>
          ))}
        </div>

        {/* Task list */}
        {loading ? (
          <p className="sj-micro">Loading...</p>
        ) : visible.length === 0 ? (
          <p className="sj-micro" style={{ paddingTop: "var(--sp-2)" }}>
            {filter === "all" ? "No tasks yet. Create one above." : `No ${filter.replace("_", " ")} tasks.`}
          </p>
        ) : (
          <div className="sj-flex-col sj-gap-1">
            {visible.map((task) => {
              const isExpanded = expanded === task.id;
              const overdue = isDueOverdue(task.due_at) && task.status !== "done";
              return (
                <div key={task.id} className="sj-card sj-flex-col" style={{ gap: "var(--sp-1)", padding: "var(--sp-2) var(--sp-3)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                    {/* Status checkbox */}
                    <button
                      onClick={() => cycleStatus(task)}
                      title={`Mark as ${STATUS_CYCLE[task.status]}`}
                      style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        border: `1.5px solid ${task.status === "done" ? "var(--color-accent)" : "var(--color-border)"}`,
                        background: task.status === "done" ? "var(--color-accent)" : task.status === "in_progress" ? "var(--color-surface-3)" : "transparent",
                        cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {task.status === "done" && <span style={{ fontSize: 9, color: "#fff", lineHeight: 1 }}>✓</span>}
                      {task.status === "in_progress" && <span style={{ fontSize: 9, color: "var(--color-text-muted)", lineHeight: 1 }}>▶</span>}
                    </button>

                    {/* Title */}
                    <span
                      style={{
                        flex: 1, fontSize: 12, color: task.status === "done" ? "var(--color-text-muted)" : "var(--color-text)",
                        textDecoration: task.status === "done" ? "line-through" : "none",
                      }}
                    >
                      {task.title}
                    </span>

                    {/* Priority dot */}
                    <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: PRIORITY_COLORS[task.priority] }} />

                    {/* Due date */}
                    {task.due_at && (
                      <span style={{ fontSize: 10, color: overdue ? "#e25c5c" : "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 3 }}>
                        <Calendar size={9} />
                        {formatDue(task.due_at)}
                      </span>
                    )}

                    {/* Expand / delete */}
                    <button onClick={() => setExpanded(isExpanded ? null : task.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--color-icon)" }}>
                      <ChevronRight size={12} style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }} />
                    </button>
                    <button onClick={() => deleteTask(task.id)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--color-text-muted)" }}>
                      <Trash2 size={11} />
                    </button>
                  </div>

                  {isExpanded && (
                    <div style={{ paddingLeft: 22, paddingTop: "var(--sp-1)" }}>
                      <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
                        Priority: <b style={{ color: PRIORITY_COLORS[task.priority] }}>{task.priority}</b>
                        {" · "}Status: <b>{STATUS_LABEL[task.status]}</b>
                        {task.due_at && <>{" · "}Due: <b>{new Date(task.due_at).toLocaleDateString()}</b></>}
                      </span>
                      {task.notes && (
                        <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "var(--sp-1)", whiteSpace: "pre-wrap" }}>{task.notes}</p>
                      )}
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
