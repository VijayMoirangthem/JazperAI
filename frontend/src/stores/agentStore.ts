import { create } from "zustand";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/";

// ── Types (match /api/agents/live response exactly) ────────────────────────

export interface AgentLive {
  agent_id: string;
  codename: string;
  name: string;
  status: "active" | "standby" | "inactive" | "error";
  department: string;
  badge_color: string;
  avatar_emoji: string;
  avatar_source: "dicebear" | "custom" | "emoji";
  avatar_style: string;
  avatar_seed: string;
  avatar_custom_path: string | null;
  level: number;
  health_score: number | null;
  updated_at: string;
  // injected client-side from WS events
  runtime_status: "idle" | "thinking" | "working" | "error";
  action?: string;
}

export interface MessageRecord {
  id: string;
  from: string;
  to: string;
  from_codename?: string;
  to_codename?: string;
  subject: string;
  body: string;
  act: string;
  ts: string;
  read?: boolean;
}

export interface ActivityEntry {
  id: number;
  agent?: string;
  ts: number;
  kind: string;
  text: string;
}

export interface DeptLive {
  id: string;           // slug: "executive", "it" — use for DEPT lookups & agent matching
  name: string;         // display: "Executive", "IT Department"
  description: string;
  head_agent: string | null;
  enabled: boolean;
  budget_daily_usd: number;
  budget_used_today: number;
  badge_color: string;
  floor_position: Record<string, number> | null;
  created_at: string;
}

// ── Store ──────────────────────────────────────────────────────────────────

interface AgentStoreState {
  agents: AgentLive[];
  departments: DeptLive[];
  autonomy: Record<string, boolean>;
  selectedAgentId: string | null;
  selectedDeptId: string | null;
  isLoading: boolean;
  lastFetched: number | null;
  wsConnected: boolean;
  contextMenu: { agentId: string; x: number; y: number } | null;
  messages: MessageRecord[];
  activities: ActivityEntry[];

  fetchLive: () => Promise<void>;
  setSelectedAgent: (id: string | null) => void;
  setSelectedDept: (name: string | null) => void;
  toggleDept: (name: string, enabled: boolean) => Promise<void>;
  setRuntimeStatus: (agentId: string, status: AgentLive["runtime_status"]) => void;
  setAgentAction: (agentId: string, action: string) => void;
  setContextMenu: (cm: { agentId: string; x: number; y: number } | null) => void;
  appendMessages: (msgs: MessageRecord[]) => void;
  appendActivity: (entries: ActivityEntry[]) => void;
  clearActivity: () => void;
}

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  agents: [],
  departments: [],
  autonomy: {},
  selectedAgentId: null,
  selectedDeptId: null,
  isLoading: false,
  lastFetched: null,
  wsConnected: false,
  contextMenu: null,
  messages: [],
  activities: [],

  fetchLive: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch(`${API}/api/agents/live`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();

      // Preserve existing runtime_status if agent already in store
      const existing = new Map(get().agents.map(a => [a.agent_id, a.runtime_status]));
      const existingAction = new Map(get().agents.map(a => [a.agent_id, a.action]));

      const agents: AgentLive[] = (data.agents as Omit<AgentLive, "runtime_status">[]).map(a => ({
        ...a,
        runtime_status: existing.get(a.agent_id) ?? "idle",
        action: existingAction.get(a.agent_id) ?? undefined,
      }));

      set({
        agents,
        departments: data.departments as DeptLive[],
        autonomy: data.autonomy ?? {},
        lastFetched: Date.now(),
        isLoading: false,
      });
    } catch (e) {
      console.warn("[agentStore] fetchLive unavailable:", e);
      set({ isLoading: false });
    }
  },

  setSelectedAgent: (id) => set({ selectedAgentId: id, selectedDeptId: null }),
  setSelectedDept: (name) => set({ selectedDeptId: name, selectedAgentId: null }),
  setContextMenu: (cm) => set({ contextMenu: cm }),

  setRuntimeStatus: (agentId, status) =>
    set(s => ({
      agents: s.agents.map(a => (a.agent_id === agentId ? { ...a, runtime_status: status } : a)),
    })),

  setAgentAction: (agentId, action) =>
    set(s => ({
      agents: s.agents.map(a => (a.agent_id === agentId ? { ...a, action } : a)),
    })),

  appendMessages: (msgs) =>
    set(s => {
      const known = new Set(s.messages.map(m => m.id));
      const fresh = msgs.filter(m => !known.has(m.id));
      if (fresh.length === 0) return s;
      return { messages: [...fresh.reverse(), ...s.messages].slice(0, 200) };
    }),

  appendActivity: (entries) =>
    set(s => {
      if (!entries.length) return s;
      return { activities: [...entries, ...s.activities].slice(0, 300) };
    }),

  clearActivity: () => set({ activities: [] }),

  toggleDept: async (name, enabled) => {
    try {
      await fetch(`${API}/api/agents/departments/${name}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      await get().fetchLive();
    } catch (e) {
      console.error("[agentStore] toggleDept error:", e);
    }
  },
}));

// ── WebSocket singleton ────────────────────────────────────────────────────
// One connection for the entire app lifetime; reconnects on drop.

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export function connectCommandCenterWS() {
  if (typeof window === "undefined") return;
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;

  _ws = new WebSocket(WS_URL);

  _ws.onopen = () => {
    useAgentStore.setState({ wsConnected: true });
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  };

  _ws.onclose = () => {
    useAgentStore.setState({ wsConnected: false });
    _ws = null;
    _reconnectTimer = setTimeout(connectCommandCenterWS, 5000);
  };

  _ws.onerror = () => {
    useAgentStore.setState({ wsConnected: false });
  };

  _ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as { event: string; payload: Record<string, unknown> };
      if (msg.event === "AGENT_STATUS") {
        const { agent_id, runtime_status } = msg.payload as { agent_id: string; runtime_status: AgentLive["runtime_status"] };
        useAgentStore.getState().setRuntimeStatus(agent_id, runtime_status);
      }
      if (msg.event === "AGENT_ACTION") {
        const { agent_id, action } = msg.payload as { agent_id: string; action: string };
        if (agent_id && action) useAgentStore.getState().setAgentAction(agent_id, action);
      }
      if (msg.event === "AGENT_MESSAGE") {
        const p = msg.payload as any;
        useAgentStore.getState().appendMessages([{
          id: p.id ?? `${p.from}->${p.to}:${Date.now()}`,
          from: p.from,
          to: p.to,
          from_codename: p.from_codename ?? p.from,
          to_codename: p.to_codename ?? p.to,
          subject: p.subject ?? "",
          body: p.body ?? "",
          act: p.act ?? "inform",
          ts: p.ts ?? new Date().toISOString(),
        }]);
      }
      if (msg.event === "AGENT_ACTIVITY") {
        const p = msg.payload as any;
        useAgentStore.getState().appendActivity([{
          id: p.id ?? Date.now(),
          agent: p.agent,
          ts: p.ts ?? Date.now(),
          kind: p.kind ?? "system",
          text: p.text ?? "",
        }]);
      }
      // CHAT_REPLY or other events: mark Jazper as "working" briefly
      if (msg.event === "CHAT_REPLY") {
        const jazper = useAgentStore.getState().agents.find(a => a.codename === "jazper");
        if (jazper) {
          useAgentStore.getState().setRuntimeStatus(jazper.agent_id, "working");
          setTimeout(() => useAgentStore.getState().setRuntimeStatus(jazper.agent_id, "idle"), 2500);
        }
      }
    } catch {
      // ignore malformed messages
    }
  };
}
