"use client";

import { useCallback, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Node,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { usePipelineStore, type PipelineNodeData } from "@/stores/pipelineStore";
import { GitBranch, User, Cpu, Wrench, CheckCircle2, Clock, AlertCircle, Loader2 } from "lucide-react";

// ── Status indicator ──────────────────────────────────────────────────────────

function StatusIcon({ status }: { status?: PipelineNodeData["status"] }) {
  const s = { width: 13, height: 13, flexShrink: 0 };
  switch (status) {
    case "running": return <Loader2 style={{ ...s, color: "#f59e0b", animation: "spin 1s linear infinite" }} />;
    case "done":    return <CheckCircle2 style={{ ...s, color: "#10b981" }} />;
    case "error":   return <AlertCircle  style={{ ...s, color: "#ef4444" }} />;
    default:        return <Clock        style={{ ...s, color: "#475569" }} />;
  }
}

// ── Custom node ───────────────────────────────────────────────────────────────

const KIND_META: Record<PipelineNodeData["kind"], { bg: string; border: string; icon: React.ReactNode }> = {
  user:         { bg: "#0d1220", border: "#334155", icon: <User size={13} color="#94a3b8" /> },
  orchestrator: { bg: "#0d0d2a", border: "#4f46e5", icon: <Cpu  size={13} color="#6366f1" /> },
  agent:        { bg: "#0a0a1e", border: "#7c3aed", icon: <GitBranch size={13} color="#8b5cf6" /> },
  tool:         { bg: "#100a00", border: "#c2410c", icon: <Wrench    size={13} color="#f97316" /> },
  result:       { bg: "#001a10", border: "#059669", icon: <CheckCircle2 size={13} color="#10b981" /> },
};

function PipelineNode({ data }: NodeProps<Node<PipelineNodeData>>) {
  const d = data;
  const meta = KIND_META[d.kind] ?? KIND_META.agent;
  const accent = d.color ?? meta.border;

  return (
    <>
      <Handle type="target" position={Position.Left}  style={{ background: accent, border: "none", width: 6, height: 6 }} />
      <div style={{
        minWidth: 130, maxWidth: 190, padding: "7px 10px",
        borderRadius: 8,
        background: meta.bg,
        border: `1px solid ${d.status === "running" ? accent : meta.border}`,
        boxShadow: d.status === "running"
          ? `0 0 12px color-mix(in srgb, ${accent} 35%, transparent)`
          : d.status === "done"
            ? "0 0 6px rgba(16,185,129,0.15)"
            : "none",
        fontFamily: "inherit",
        transition: "box-shadow 0.3s",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: d.detail ? 4 : 0 }}>
          {meta.icon}
          <span style={{ fontSize: 10, fontWeight: 800, color: accent, letterSpacing: "0.06em", textTransform: "uppercase", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {d.label}
          </span>
          <StatusIcon status={d.status} />
        </div>
        {d.detail && (
          <div style={{ fontSize: 9.5, color: "#64748b", lineHeight: 1.4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {d.detail}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ background: accent, border: "none", width: 6, height: 6 }} />
    </>
  );
}

const NODE_TYPES = { pipelineNode: PipelineNode };

// ── Flow canvas for a single run ──────────────────────────────────────────────

function RunCanvas({ runId }: { runId: string }) {
  const runs        = usePipelineStore(s => s.runs);
  const run         = runs.find(r => r.id === runId);
  const [nodes, setNodes, onNodesChange] = useNodesState(run?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState(run?.edges ?? []);

  // Sync store → ReactFlow state on every render
  useEffect(() => {
    if (run) {
      setNodes(run.nodes);
      setEdges(run.edges);
    }
  }, [run, setNodes, setEdges]);

  if (!run) return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 12 }}>
      Run not found
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.28 }}
        minZoom={0.3}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        style={{ background: "transparent" }}
        defaultEdgeOptions={{
          type: "smoothstep",
          style: { stroke: "#1e2845", strokeWidth: 1.5 },
        }}
      >
        <Background color="#1e2845" gap={28} size={1} />
        <Controls
          showInteractive={false}
          style={{
            background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: 8, boxShadow: "none",
          }}
        />
        <MiniMap
          nodeColor={n => ((n.data as unknown) as PipelineNodeData).color ?? "#334155"}
          maskColor="rgba(0,0,0,0.72)"
          style={{
            background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: 8,
          }}
        />
      </ReactFlow>
    </div>
  );
}

// ── Run history sidebar ───────────────────────────────────────────────────────

function RunList() {
  const runs        = usePipelineStore(s => s.runs);
  const activeId    = usePipelineStore(s => s.activeRunId);
  const viewingId   = usePipelineStore(s => s.viewingRunId);
  const selectRun   = usePipelineStore(s => s.selectRun);
  const clearAll    = usePipelineStore(s => s.clearAll);

  function fmt(ms: number) {
    const d = Math.round((Date.now() - ms) / 1000);
    if (d < 60) return `${d}s ago`;
    if (d < 3600) return `${Math.round(d/60)}m ago`;
    return `${Math.round(d/3600)}h ago`;
  }

  function dur(run: typeof runs[0]) {
    if (!run.finishedAt) return "live";
    return `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s`;
  }

  if (runs.length === 0) return (
    <div style={{ padding: "32px 12px", textAlign: "center", color: "#475569", fontSize: 12 }}>
      No runs yet.<br />Send a message in Chat to see the pipeline.
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px 6px" }}>
        <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569" }}>
          History ({runs.length})
        </span>
        <button
          onClick={clearAll}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#475569", fontSize: 9, padding: "2px 4px" }}
        >
          Clear
        </button>
      </div>

      {runs.map(run => {
        const isActive   = run.id === activeId;
        const isViewing  = run.id === viewingId;
        const agentNodes = run.nodes.filter(n => n.data.kind === "agent");

        return (
          <button
            key={run.id}
            onClick={() => selectRun(run.id)}
            style={{
              display: "block", width: "100%", textAlign: "left",
              background: isViewing ? "rgba(99,102,241,0.1)" : "transparent",
              border: "none", borderLeft: isViewing ? "3px solid #6366f1" : "3px solid transparent",
              padding: "8px 12px", cursor: "pointer",
              borderBottom: "1px solid var(--color-border)",
              fontFamily: "inherit",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: isViewing ? "#818cf8" : "var(--color-text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {run.query.slice(0, 40)}{run.query.length > 40 ? "…" : ""}
              </span>
              <span style={{
                fontSize: 8, fontWeight: 800, padding: "1px 5px", borderRadius: 10, flexShrink: 0,
                background: isActive ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.10)",
                color: isActive ? "#f59e0b" : "#10b981",
                textTransform: "uppercase", letterSpacing: "0.05em",
              }}>
                {isActive ? "live" : dur(run)}
              </span>
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {agentNodes.slice(0, 4).map(n => (
                <span key={n.id} style={{
                  fontSize: 8, padding: "1px 6px", borderRadius: 8,
                  background: `color-mix(in srgb, ${(n.data as PipelineNodeData).color ?? "#6366f1"} 12%, transparent)`,
                  color: (n.data as PipelineNodeData).color ?? "#6366f1",
                  fontWeight: 700, textTransform: "uppercase",
                }}>
                  {(n.data as PipelineNodeData).label}
                </span>
              ))}
              {agentNodes.length > 4 && (
                <span style={{ fontSize: 8, color: "#475569" }}>+{agentNodes.length - 4}</span>
              )}
            </div>
            <div style={{ fontSize: 8, color: "#334155", marginTop: 3 }}>
              {fmt(run.startedAt)}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 16, color: "#334155",
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: "50%",
        background: "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.06) 100%)",
        border: "1px solid rgba(99,102,241,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <GitBranch size={28} color="#4f46e5" />
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", marginBottom: 6 }}>
          No pipeline running
        </div>
        <div style={{ fontSize: 11, color: "#475569", maxWidth: 260, lineHeight: 1.6 }}>
          Send a message in Chat — the full agent pipeline will appear here in real time.
        </div>
      </div>
      <div style={{
        display: "flex", gap: 10, padding: "10px 16px", borderRadius: 8,
        background: "rgba(30,40,69,0.6)", border: "1px solid var(--color-border)",
      }}>
        {["Scout", "Hermes", "Sage", "Atlas", "Phantom"].map((a, i) => (
          <span key={a} style={{
            fontSize: 9, fontWeight: 800, padding: "3px 8px", borderRadius: 12,
            textTransform: "uppercase", letterSpacing: "0.06em",
            background: `color-mix(in srgb, ${["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444"][i]} 12%, transparent)`,
            color: ["#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444"][i],
          }}>
            {a}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function PipelinePanel() {
  const runs       = usePipelineStore(s => s.runs);
  const activeId   = usePipelineStore(s => s.activeRunId);
  const viewingId  = usePipelineStore(s => s.viewingRunId);
  const selectRun  = usePipelineStore(s => s.selectRun);

  // Auto-select the most recent run
  useEffect(() => {
    if (runs.length > 0 && !viewingId) selectRun(runs[0].id);
  }, [runs.length, viewingId, selectRun, runs]);

  // Auto-follow live run
  useEffect(() => {
    if (activeId) selectRun(activeId);
  }, [activeId, selectRun]);

  return (
    <div className="sj-panel" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "14px 18px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
      }}>
        <GitBranch size={16} color="#6366f1" />
        <span style={{ fontWeight: 800, fontSize: 13, color: "var(--color-text)", letterSpacing: "0.04em" }}>
          Pipeline Mind Map
        </span>
        {activeId && (
          <span style={{
            fontSize: 9, fontWeight: 800, padding: "2px 9px", borderRadius: 12,
            background: "rgba(245,158,11,0.15)", color: "#f59e0b",
            textTransform: "uppercase", letterSpacing: "0.07em",
            animation: "pulse 2s ease-in-out infinite",
          }}>
            ● Live
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#475569" }}>
          {runs.length} run{runs.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* Run history sidebar */}
        <div style={{
          width: 200, flexShrink: 0, overflowY: "auto",
          borderRight: "1px solid var(--color-border)",
          background: "rgba(0,0,0,0.18)",
        }}>
          <RunList />
        </div>

        {/* Flow canvas */}
        {viewingId ? <RunCanvas runId={viewingId} /> : <EmptyState />}
      </div>

      <style>{`
        @keyframes spin   { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse  { 0%,100% { opacity: 1; } 50% { opacity: 0.55; } }
        .react-flow__controls-button { background: var(--color-bg) !important; border-color: var(--color-border) !important; color: var(--color-text-dim) !important; }
        .react-flow__controls-button:hover { background: var(--color-border) !important; }
        .react-flow__minimap-mask { fill: rgba(0,0,0,0.72); }
      `}</style>
    </div>
  );
}
