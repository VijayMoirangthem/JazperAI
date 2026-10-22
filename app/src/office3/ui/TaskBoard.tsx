"use client";

import { useEffect, useMemo, useState } from "react";

type Status = "todo" | "doing" | "blocked" | "done";
type Task = { id: string; title: string; assignee?: string; priority?: string };
type Board = Record<Status, Task[]>;
const statuses: Status[] = ["todo", "doing", "blocked", "done"];
const empty: Board = { todo: [], doing: [], blocked: [], done: [] };

export function TaskBoard({ onClose }: { onClose(): void }) {
  const [board, setBoard] = useState<Board>(empty);
  const [moving, setMoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<{ task: Task; from: Status } | null>(null);
  const total = useMemo(() => statuses.reduce((count, status) => count + board[status].length, 0), [board]);
  const refresh = async () => {
    const response = await fetch("/api/hive/tasks");
    if (!response.ok) throw Error("Task board is unavailable");
    setBoard({ ...empty, ...await response.json() });
  };
  useEffect(() => { void refresh().catch(() => setError("Unable to load tasks.")); }, []);
  const move = async (task: Task, from: Status, to: Status) => {
    if (from === to) return;
    setMoving(task.id); setError(null);
    try {
      const response = await fetch(`/api/hive/tasks/${encodeURIComponent(task.id)}/move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: to }) });
      if (!response.ok) throw Error("Move failed");
      setBoard(current => ({ ...current, [from]: current[from].filter(item => item.id !== task.id), [to]: [...current[to], task] }));
    } catch { setError("Task move failed. The board was not changed locally."); }
    finally { setMoving(null); }
  };
  return <section className="absolute inset-6 z-40 overflow-auto rounded-xl bg-slate-950/95 p-5 text-white shadow-2xl">
    <button className="float-right text-xs opacity-70" onClick={onClose}>Close</button>
    <h2 className="text-lg font-semibold">Task board</h2>
    <div className="mb-4 mt-2 flex items-center gap-3 text-xs text-slate-300"><span>{board.done.length}/{total} complete</span><div className="h-1.5 w-32 overflow-hidden rounded bg-slate-800"><div className="h-full bg-emerald-500" style={{ width: `${total ? board.done.length / total * 100 : 0}%` }} /></div><button className="rounded bg-slate-800 px-2 py-1 hover:bg-slate-700" onClick={() => void refresh().catch(() => setError("Unable to refresh tasks."))}>Refresh</button></div>
    {error && <p className="mb-3 rounded bg-rose-950 p-2 text-xs text-rose-200">{error}</p>}
    <div className="grid grid-cols-4 gap-3">{statuses.map((status, index) => <div key={status} className={`min-h-32 rounded-lg bg-slate-900 p-2 ${dragged ? "ring-1 ring-slate-700" : ""}`} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragged) { void move(dragged.task, dragged.from, status); setDragged(null); } }}><h3 className="mb-2 flex justify-between text-xs font-semibold uppercase tracking-wide text-slate-300"><span>{status}</span><span>{board[status].length}</span></h3>{board[status].map(task => <article key={task.id} draggable className="mb-2 cursor-grab rounded bg-slate-800 p-2 text-xs active:cursor-grabbing" onDragStart={() => setDragged({ task, from: status })} onDragEnd={() => setDragged(null)}><div>{task.title}</div><div className="mt-1 text-[10px] opacity-50">{task.assignee || "Unassigned"} · {task.priority || "medium"}</div><div className="mt-2 flex gap-1">{index > 0 && <button disabled={moving === task.id} className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] disabled:opacity-50" onClick={() => void move(task, status, statuses[index - 1])}>←</button>}{index < statuses.length - 1 && <button disabled={moving === task.id} className="rounded bg-blue-700 px-1.5 py-0.5 text-[10px] disabled:opacity-50" onClick={() => void move(task, status, statuses[index + 1])}>{moving === task.id ? "…" : "→"}</button>}</div></article>)}</div>)}</div>
  </section>;
}
