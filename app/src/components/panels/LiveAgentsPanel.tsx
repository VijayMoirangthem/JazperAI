"use client";

import { useEffect } from "react";
import { Activity } from "lucide-react";
import { useLiveAgents } from "@/stores/liveAgentsStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";

const STATE_COLOR: Record<string, string> = {
  idle: "#64748b",
  working: "#22c55e",
  planning: "#38bdf8",
  waiting_human: "#f59e0b",
  error: "#ef4444",
};

/** Live view of agent-state-change events from the JSON-RPC bus (/ws/rpc). */
export function LiveAgentsPanel() {
  const agents = useLiveAgents((s) => s.agents);
  const connected = useLiveAgents((s) => s.connected);
  const connect = useLiveAgents((s) => s.connect);
  useEffect(() => connect(WS_URL), [connect]);

  const demo = () => fetch(`${API}/ws/demo`, { method: "POST" }).catch(() => undefined);
  const list = Object.values(agents).sort((a, b) => b.seq - a.seq);

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
