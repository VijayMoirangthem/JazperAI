"use client";

import { useEffect, useRef, useState } from "react";
import { Activity } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";

interface AgentRow {
  slug: string;
  state: string;
  bubble: string | null;
  reason: string | null;
  seq: number;
  ts: string;
}

interface Notification {
  method: string;
  seq?: number;
  ts?: string;
  params: {
    agent_slug?: string;
    to_state?: string;
    status_bubble?: string | null;
    reason?: string | null;
  };
}

const STATE_COLOR: Record<string, string> = {
  idle: "#64748b",
  working: "#22c55e",
  planning: "#38bdf8",
  waiting_human: "#f59e0b",
  error: "#ef4444",
};

/** Live view of agent-state-change events from the JSON-RPC bus (/ws/rpc). */
export function LiveAgentsPanel() {
  const [rows, setRows] = useState<Record<string, AgentRow>>({});
  const [connected, setConnected] = useState(false);
  const lastSeq = useRef(0);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        setConnected(true);
        ws?.send(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "subscribe",
            params: { topics: ["agent-state-change"], since: { "agent-state-change": lastSeq.current } },
          }),
        );
      };
      ws.onmessage = (e) => {
        const m: Notification = JSON.parse(e.data);
        if (m.method !== "agent-state-change" || !m.params.agent_slug) return;
        const slug = m.params.agent_slug;
        lastSeq.current = Math.max(lastSeq.current, m.seq ?? 0);
        setRows((r) => ({
          ...r,
          [slug]: {
            slug,
            state: m.params.to_state ?? "idle",
            bubble: m.params.status_bubble ?? null,
            reason: m.params.reason ?? null,
            seq: m.seq ?? 0,
            ts: m.ts ?? "",
          },
        }));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 1000 + Math.random() * 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  const demo = () => fetch(`${API}/ws/demo`, { method: "POST" }).catch(() => undefined);
  const list = Object.values(rows).sort((a, b) => b.seq - a.seq);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Activity size={20} />
        <h2 className="text-lg font-semibold">Live Agents</h2>
        <span className="text-xs" style={{ color: connected ? "#22c55e" : "#ef4444" }}>
          {connected ? "connected" : "reconnecting…"}
        </span>
        <button onClick={demo} className="ml-auto px-3 py-1 rounded border text-sm">
          Emit demo events
        </button>
      </div>
      {list.length === 0 && (
        <p className="text-sm opacity-70">
          No agent activity yet. Chat with an agent, or click “Emit demo events”.
        </p>
      )}
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.slug} className="flex items-center gap-3 rounded border p-3">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: STATE_COLOR[a.state] ?? "#a855f7" }}
            />
            <span className="font-mono text-sm">{a.slug}</span>
            <span className="text-xs opacity-70">{a.state}</span>
            <span className="text-sm ml-2 truncate">{a.bubble ?? a.reason ?? ""}</span>
            <span className="ml-auto text-xs opacity-50">#{a.seq}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
