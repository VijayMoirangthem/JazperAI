"use client";

import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type NodeKind = "user" | "orchestrator" | "agent" | "tool" | "result";

export type PipelineNodeData = {
  kind:    NodeKind;
  label:   string;
  detail?: string;
  color?:  string;
  status?: "pending" | "running" | "done" | "error";
  ts?:     number;
} & Record<string, unknown>;

export interface PipelineRun {
  id:        string;
  query:     string;
  startedAt: number;
  finishedAt?: number;
  nodes:  Node<PipelineNodeData>[];
  edges:  Edge[];
}

// ── Agent → colour palette ────────────────────────────────────────────────────

const AGENT_COLORS: Record<string, string> = {
  scout:   "#3b82f6",
  hermes:  "#10b981",
  sage:    "#8b5cf6",
  atlas:   "#f59e0b",
  phantom: "#ef4444",
  lens:    "#ec4899",
  jazper:  "#6366f1",
};

function agentColor(codename: string) {
  return AGENT_COLORS[codename?.toLowerCase()] ?? "#94a3b8";
}

// ── Node/edge factories ───────────────────────────────────────────────────────

let _idSeq = 0;
function uid() { return `pn-${++_idSeq}`; }

function mkNode(
  id:   string,
  kind: NodeKind,
  label: string,
  x: number, y: number,
  detail?: string,
  color?: string,
  status: PipelineNodeData["status"] = "pending",
): Node<PipelineNodeData> {
  return {
    id,
    type: "pipelineNode",
    position: { x, y },
    data: { kind, label, detail, color, status },
  };
}

function mkEdge(src: string, tgt: string, animated = false): Edge {
  return { id: `${src}→${tgt}`, source: src, target: tgt, animated, type: "smoothstep" };
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface PipelineState {
  runs:         PipelineRun[];
  activeRunId:  string | null;
  viewingRunId: string | null;   // which run the user is inspecting

  startRun:    (query: string) => void;
  applyEvent:  (type: string, payload: Record<string, unknown>) => void;
  finishRun:   (meta: Record<string, unknown>) => void;
  selectRun:   (id: string | null) => void;
  clearAll:    () => void;
}

export const usePipelineStore = create<PipelineState>((set, get) => ({
  runs:         [],
  activeRunId:  null,
  viewingRunId: null,

  // ── Create a new run with a user-query node ─────────────────────────────
  startRun(query) {
    const id  = `run-${Date.now()}`;
    const userNode = mkNode("user", "user", "You", 40, 300, query, "#94a3b8", "done");
    const orchNode = mkNode("orch", "orchestrator", "Orchestrator", 260, 300, "routing…", "#6366f1", "running");
    const run: PipelineRun = {
      id,
      query,
      startedAt: Date.now(),
      nodes: [userNode, orchNode],
      edges: [mkEdge("user", "orch", true)],
    };
    set(s => ({
      runs:        [run, ...s.runs].slice(0, 20),  // keep 20 runs max
      activeRunId:  id,
      viewingRunId: id,
    }));
  },

  // ── Merge incoming SSE event into the active run ────────────────────────
  applyEvent(type, payload) {
    const { activeRunId, runs } = get();
    if (!activeRunId) return;

    set(s => {
      const idx = s.runs.findIndex(r => r.id === activeRunId);
      if (idx === -1) return s;

      const run  = { ...s.runs[idx], nodes: [...s.runs[idx].nodes], edges: [...s.runs[idx].edges] };
      const find = (nodeId: string) => run.nodes.findIndex(n => n.id === nodeId);
      const patch = (nodeId: string, updates: Partial<PipelineNodeData>) => {
        const i = find(nodeId);
        if (i !== -1) {
          run.nodes[i] = { ...run.nodes[i], data: { ...run.nodes[i].data, ...updates } };
        }
      };

      switch (type) {

        case "ORCHESTRATOR_PLAN": {
          // payload: { agents: string[], query: string }
          const agents = (payload.agents as string[] | undefined) ?? [];
          patch("orch", { status: "done", detail: `→ ${agents.join(", ") || "…"}` });

          const agentCount = agents.length;
          agents.forEach((codename, i) => {
            const nodeId = `agent-${codename}`;
            if (find(nodeId) !== -1) return;          // already exists
            const ySpread = Math.max(120, agentCount * 110);
            const y = 300 - (agentCount - 1) * 55 + i * 110;
            run.nodes.push(mkNode(nodeId, "agent", codename.toUpperCase(), 480, y, "assigned", agentColor(codename), "pending"));
            run.edges.push(mkEdge("orch", nodeId, true));
          });
          break;
        }

        case "AGENT_START": {
          const codename = (payload.codename ?? payload.agent_id ?? "") as string;
          const nodeId   = `agent-${codename}`;
          patch(nodeId, { status: "running", detail: "thinking…" });
          break;
        }

        case "AGENT_TOOL": {
          const codename = (payload.codename ?? payload.agent_id ?? "") as string;
          const tool     = (payload.tool ?? payload.tool_name ?? "tool") as string;
          const agentId  = `agent-${codename}`;
          const toolId   = `tool-${codename}-${tool}-${_idSeq++}`;

          // Find agent y to place tool beside it
          const agentIdx = find(agentId);
          const agentY   = agentIdx !== -1 ? run.nodes[agentIdx].position.y : 300;

          run.nodes.push(mkNode(toolId, "tool", tool, 700, agentY, (payload.args as string | undefined)?.slice(0, 60), "#f97316", "running"));
          if (find(agentId) !== -1) run.edges.push(mkEdge(agentId, toolId, true));
          break;
        }

        case "AGENT_TOOL_RESULT": {
          const tool   = (payload.tool ?? payload.tool_name ?? "tool") as string;
          const codename = (payload.codename ?? payload.agent_id ?? "") as string;
          // Mark all tool nodes for this agent+tool as done
          run.nodes = run.nodes.map(n => {
            if (n.data.kind === "tool" && n.id.startsWith(`tool-${codename}-${tool}`)) {
              return { ...n, data: { ...n.data, status: "done" as const } };
            }
            return n;
          });
          break;
        }

        case "AGENT_DONE": {
          const codename = (payload.codename ?? payload.agent_id ?? "") as string;
          const nodeId   = `agent-${codename}`;
          const preview  = ((payload.result ?? payload.content ?? "") as string).slice(0, 80);
          patch(nodeId, { status: "done", detail: preview || "done" });
          patch("orch", { status: "running" });          // orchestrator still assembling

          // Add result node if this is the final/only agent
          const resultId = `result-${codename}`;
          if (find(resultId) === -1) {
            const agentIdx = find(nodeId);
            const agentY   = agentIdx !== -1 ? run.nodes[agentIdx].position.y : 300;
            run.nodes.push(mkNode(resultId, "result", "Result", 900, agentY, preview || "…", "#22c55e", "done"));
            run.edges.push(mkEdge(nodeId, resultId));
          }
          break;
        }

        case "AGENT_ERROR": {
          const codename = (payload.codename ?? payload.agent_id ?? "") as string;
          patch(`agent-${codename}`, { status: "error", detail: (payload.error as string | undefined) ?? "error" });
          break;
        }

      }

      const updated = [...s.runs];
      updated[idx] = run;
      return { runs: updated };
    });
  },

  // ── Finalise the run ────────────────────────────────────────────────────
  finishRun(_meta) {
    const { activeRunId } = get();
    if (!activeRunId) return;
    set(s => {
      const idx = s.runs.findIndex(r => r.id === activeRunId);
      if (idx === -1) return s;
      const run = { ...s.runs[idx], finishedAt: Date.now() };

      // Mark orchestrator done
      run.nodes = run.nodes.map(n =>
        n.id === "orch" ? { ...n, data: { ...n.data, status: "done" as const } } : n
      );

      const updated = [...s.runs];
      updated[idx]  = run;
      return { runs: updated, activeRunId: null };
    });
  },

  selectRun: (id) => set({ viewingRunId: id }),
  clearAll:  () => set({ runs: [], activeRunId: null, viewingRunId: null }),
}));

// ── Window event bridge — wires ChatPanel events into the store ────────────────

if (typeof window !== "undefined") {
  let _initialized = false;

  function initBridge() {
    if (_initialized) return;
    _initialized = true;

    window.addEventListener("sj:query", (e) => {
      const { query } = (e as CustomEvent).detail;
      usePipelineStore.getState().startRun(query as string);
    });

    window.addEventListener("sj:agent", (e) => {
      const { type, payload } = (e as CustomEvent).detail as { type: string; payload: Record<string, unknown> };
      const store = usePipelineStore.getState();
      if (type === "TOKENS") {
        store.finishRun(payload);
      } else {
        store.applyEvent(type, payload);
      }
    });

    window.addEventListener("sj:tokens", (e) => {
      usePipelineStore.getState().finishRun((e as CustomEvent).detail as Record<string, unknown>);
    });
  }

  // defer so it runs after hydration
  setTimeout(initBridge, 0);
}
