"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, X, ListTodo, Mail, UserPlus, Timer } from "lucide-react";
import { useToast } from "@/components/ToastProvider";

export function QuickActionsBar() {
  const toast = useToast();
  const [open, setOpen]               = useState(false);
  const [mode, setMode]               = useState<"palette" | "task">("palette");
  const [newTaskInput, setNewTaskInput] = useState("");
  const [saving, setSaving]           = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "task") setTimeout(() => inputRef.current?.focus(), 50);
  }, [mode]);

  useEffect(() => {
    if (!open) { setMode("palette"); setNewTaskInput(""); }
  }, [open]);

  async function createTask() {
    const title = newTaskInput.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await fetch("http://localhost:8000/api/tasks/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, status: "pending", priority: "medium" }),
      });
      toast(`Task created: ${title}`, "success");
      setOpen(false);
    } catch { toast("Failed to create task", "error"); } finally {
      setSaving(false);
    }
  }

  const ACTIONS = [
    {
      icon: <ListTodo size={14} />, label: "New Task", color: "#6366f1",
      onClick: () => setMode("task"),
    },
    {
      icon: <Mail size={14} />, label: "Compose Email", color: "#3b82f6",
      onClick: () => { window.location.hash = "compose"; setOpen(false); },
    },
    {
      icon: <UserPlus size={14} />, label: "Add Contact", color: "#22c55e",
      onClick: () => { window.location.hash = "contacts"; setOpen(false); },
    },
    {
      icon: <Timer size={14} />, label: "Focus 25 min", color: "#f59e0b",
      onClick: () => { window.location.hash = "chat"; setOpen(false); },
    },
  ];

  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 1000,
      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "var(--sp-2)",
    }}>
      {open && (
        <div
          className="sj-card"
          style={{
            minWidth: 204, padding: "var(--sp-2)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
            display: "flex", flexDirection: "column", gap: 2,
          }}
        >
          {mode === "palette" ? (
            ACTIONS.map(a => (
              <button
                key={a.label}
                onClick={a.onClick}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--sp-3)",
                  padding: "var(--sp-2) var(--sp-2)", borderRadius: "var(--r-sm)",
                  background: "none", border: "none", cursor: "pointer", width: "100%",
                  textAlign: "left", color: "var(--color-text)",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "var(--color-surface-raised)")}
                onMouseLeave={e => (e.currentTarget.style.background = "none")}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: "var(--r-sm)", flexShrink: 0,
                  background: `color-mix(in srgb, ${a.color} 15%, transparent)`,
                  border: `1px solid ${a.color}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: a.color,
                }}>
                  {a.icon}
                </span>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</span>
              </button>
            ))
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)", padding: "var(--sp-1) var(--sp-1) var(--sp-2)" }}>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)", fontWeight: 600 }}>New Task</span>
              <input
                ref={inputRef}
                className="sj-input"
                placeholder="What needs to be done?"
                value={newTaskInput}
                onChange={e => setNewTaskInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") createTask();
                  if (e.key === "Escape") setMode("palette");
                }}
                style={{ fontSize: 13 }}
              />
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <button
                  onClick={() => setMode("palette")}
                  style={{
                    flex: 1, padding: "6px", borderRadius: "var(--r-sm)",
                    background: "var(--color-surface-raised)", border: "var(--border)",
                    cursor: "pointer", fontSize: 12, color: "var(--color-text-muted)",
                  }}
                >
                  Back
                </button>
                <button
                  onClick={createTask}
                  disabled={!newTaskInput.trim() || saving}
                  style={{
                    flex: 2, padding: "6px", borderRadius: "var(--r-sm)",
                    background: "var(--color-accent)", border: "none",
                    cursor: newTaskInput.trim() && !saving ? "pointer" : "not-allowed",
                    fontSize: 12, color: "#fff", fontWeight: 500,
                    opacity: newTaskInput.trim() && !saving ? 1 : 0.5,
                  }}
                >
                  {saving ? "Saving…" : "Add Task"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FAB */}
      <button
        onClick={() => setOpen(v => !v)}
        title={open ? "Close" : "Quick Actions (New task, email, contact, focus)"}
        style={{
          width: 48, height: 48, borderRadius: "var(--r-full)",
          background: "var(--color-accent)", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "#fff",
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          transform: open ? "rotate(45deg)" : "rotate(0deg)",
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
        }}
        onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 6px 24px rgba(0,0,0,0.4)")}
        onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.3)")}
      >
        {open ? <X size={20} /> : <Plus size={20} />}
      </button>
    </div>
  );
}
