"use client";

// useHive — live hive data (state, board, tasks, activity, terminals, messaging).

import { useCallback, useEffect, useRef, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface BoardState { board: string; routed: number }
export interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  assignee?: string;
  deps?: string[];
  created?: string;
}

export function useHive(active = true) {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [routed, setRouted] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstRun = useRef(true);

  const refreshState = useCallback(async () => {
    try {
      setLoading(true);
      const [stRes, tasksRes] = await Promise.all([
        fetch(`${API}/api/hive/state`),
        fetch(`${API}/api/hive/tasks`),
      ]);
      const st = await stRes.json();
      const tk = await tasksRes.json();
      setBoard({ board: st.board ?? "", routed: st.routed ?? 0 });
      setTasks(Array.isArray(tk) ? tk : tk.tasks ?? []);
      // merge runtime statuses into the agent store
      const agents = useAgentStore.getState().agents;
      const byId = new Map(agents.map(a => [a.agent_id, a]));
      for (const fa of st.agents ?? []) {
        const rt = fa.runtime ?? {};
        if (byId.has(fa.agent_id)) {
          if (rt.status) useAgentStore.getState().setRuntimeStatus(fa.agent_id, rt.status);
          if (rt.action) useAgentStore.getState().setAgentAction(fa.agent_id, rt.action);
        }
      }
      // hive messages → envelope feed
      const msgs = (st.messages ?? []).map((m: any) => ({
        id: m.id ?? `${m.from}-${m.to}-${m.ts}`,
        from: m.from, to: m.to,
        from_codename: m.from_codename ?? m.from,
        to_codename: m.to_codename ?? m.to,
        subject: m.subject ?? "", body: m.body ?? "",
        act: m.act ?? "inform", ts: m.ts ?? new Date().toISOString(),
      }));
      if (msgs.length) useAgentStore.getState().appendMessages(msgs);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "hive unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshActivity = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/hive/activity?limit=60`);
      if (!res.ok) return;
      const data = await res.json();
      useAgentStore.getState().appendActivity(data.activities ?? []);
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    if (!active) return;
    refreshState();
    refreshActivity();
    const iv = setInterval(refreshState, 15_000);
    const iv2 = setInterval(refreshActivity, 5_000);
    return () => { clearInterval(iv); clearInterval(iv2); };
  }, [active, refreshState, refreshActivity]);

  // ── Actions ────────────────────────────────────────────────────────────

  const route = useCallback(async () => {
    const res = await fetch(`${API}/api/hive/route`, { method: "POST" });
    const data = await res.json();
    setRouted(data.routed ?? 0);
    return data;
  }, []);

  const setBoardText = useCallback(async (text: string) => {
    await fetch(`${API}/api/hive/board`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setBoard({ board: text, routed });
  }, [routed]);

  const addTask = useCallback(async (task: { title: string; assignee?: string; priority?: string }) => {
    const res = await fetch(`${API}/api/hive/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: task.title, assignee: task.assignee ?? "", priority: task.priority ?? "medium", deps: [] }),
    });
    const data = await res.json();
    setTasks(t => [data, ...t]);
    return data;
  }, []);

  const moveTask = useCallback(async (taskId: string, status: string) => {
    const res = await fetch(`${API}/api/hive/tasks/${taskId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await res.json();
    setTasks(t => t.map(x => (x.id === taskId ? { ...x, status: data.status } : x)));
    return data;
  }, []);

  const sendMessage = useCallback(async (to: string, subject: string, body: string, act = "request") => {
    const res = await fetch(`${API}/api/hive/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, body, act }),
    });
    return res.json();
  }, []);

  const dispatch = useCallback(async (agent: string, task: string) => {
    const res = await fetch(`${API}/api/hive/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent, task }),
    });
    return res.json();
  }, []);

  const execTerminal = useCallback(async (codename: string, command: string, cwd = "") => {
    const res = await fetch(`${API}/api/hive/agents/${codename}/terminal/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, cwd }),
    });
    return res.json();
  }, []);

  const markInboxRead = useCallback(async (codename: string, msgId: string) => {
    await fetch(`${API}/api/hive/agents/${codename}/inbox/${msgId}/read`, { method: "POST" });
  }, []);

  return {
    board, tasks, routed, loading, error,
    refreshState, refreshActivity, route, setBoardText,
    addTask, moveTask, sendMessage, dispatch, execTerminal, markInboxRead,
    firstRun,
  };
}