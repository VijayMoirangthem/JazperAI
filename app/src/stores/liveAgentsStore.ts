import { create } from "zustand";
import { RpcClient, type RpcEvent } from "@/lib/rpcClient";

export interface LiveAgent {
  slug: string;
  state: string;
  bubble: string | null;
  reason: string | null;
  seq: number;
  ts: string;
}

interface LiveAgentsState {
  agents: Record<string, LiveAgent>;
  history: Record<string, LiveAgent[]>;
  connected: boolean;
  connect: (url: string) => () => void;
}

export const useLiveAgents = create<LiveAgentsState>((set) => ({
  agents: {},
  history: {},
  connected: false,
  connect: (url) => {
    const client = new RpcClient({
      url,
      topics: ["agent-state-change"],
      onStatus: (connected) => set({ connected }),
      onEvent: (e: RpcEvent) => {
        const p = e.params as { agent_slug?: string; to_state?: string; status_bubble?: string | null; reason?: string | null };
        if (!p.agent_slug) return;
        const row: LiveAgent = {
          slug: p.agent_slug, state: p.to_state ?? "idle", bubble: p.status_bubble ?? null,
          reason: p.reason ?? null, seq: e.seq, ts: e.ts,
        };
        set((s) => {
          const prior = s.history[row.slug] ?? [];
          const previous = prior[prior.length - 1];
          // The visit card is a lifecycle timeline, not a high-frequency presence log.
          // Keep only real state transitions, while the latest payload still updates above.
          const history = previous?.state === row.state ? prior : [...prior, row].slice(-8);
          return { agents: { ...s.agents, [row.slug]: row }, history: { ...s.history, [row.slug]: history } };
        });
      },
    });
    client.start();
    return () => client.stop();
  },
}));
