"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, RefreshCw } from "lucide-react";

const API = "http://localhost:8000";

interface MemoryNode {
  id: string;
  content: string;
  type: "core" | "extracted" | "auto";
  created_at?: string;
}

interface PositionedNode extends MemoryNode {
  x: number;
  y: number;
  keywords: Set<string>;
}

const TYPE_COLOR: Record<string, string> = {
  core:      "#6366f1",
  extracted: "#22c55e",
  auto:      "#f59e0b",
};

const TYPE_RING: Record<string, number> = {
  core:      80,
  extracted: 155,
  auto:      225,
};

const STOPWORDS = new Set([
  "the","and","for","that","with","this","have","from","your",
  "been","were","they","when","what","will","about","which","their",
  "there","would","could","should","after","before","where","other",
]);

function extractKeywords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length > 5 && !STOPWORDS.has(w))
      .slice(0, 10)
  );
}

function positionNodes(items: MemoryNode[], cx: number, cy: number): PositionedNode[] {
  const byType: Record<string, MemoryNode[]> = { core: [], extracted: [], auto: [] };
  for (const n of items) {
    (byType[n.type] ?? (byType.auto)).push(n);
  }

  const result: PositionedNode[] = [];
  for (const [type, typeNodes] of Object.entries(byType)) {
    const r = TYPE_RING[type] ?? 225;
    typeNodes.slice(0, 20).forEach((n, i) => {
      const angle = (i / Math.max(typeNodes.slice(0, 20).length, 1)) * Math.PI * 2 - Math.PI / 2;
      result.push({
        ...n,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        keywords: extractKeywords(n.content),
      });
    });
  }
  return result;
}

const CX = 260, CY = 260, SVG_SIZE = 520, NODE_R = 7;

export function MemoryGraphPanel() {
  const [nodes, setNodes]       = useState<PositionedNode[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [hovered, setHovered]   = useState<string | null>(null);
  const [selected, setSelected] = useState<PositionedNode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [coreRes, extractedRes, autoRes] = await Promise.all([
        fetch(`${API}/api/memory/core`).then(r => r.json()),
        fetch(`${API}/api/memory/extracted`).then(r => r.json()),
        fetch(`${API}/api/memory/auto?limit=20`).then(r => r.json()),
      ]);

      const all: MemoryNode[] = [
        ...(coreRes.memories || []).slice(0, 15).map((m: Record<string, unknown>) => ({ ...m, type: "core" as const })),
        ...(extractedRes.memories || []).slice(0, 15).map((m: Record<string, unknown>) => ({ ...m, type: "extracted" as const })),
        ...(autoRes.memories || []).slice(0, 20).map((m: Record<string, unknown>) => ({ ...m, type: "auto" as const })),
      ];

      setNodes(positionNodes(all, CX, CY));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hoveredNode  = hovered ? nodes.find(n => n.id === hovered) ?? null : null;
  const connections  = hoveredNode
    ? nodes.filter(n => n.id !== hovered && [...hoveredNode.keywords].some(k => n.keywords.has(k)))
    : [];
  const connectedIds = new Set(connections.map(n => n.id));

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="sj-panel-header">
        <Brain size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Memory Graph</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)" }}>
          {nodes.length} nodes
        </span>
        <button
          onClick={load}
          style={{ background: "none", border: "none", cursor: "pointer", marginLeft: "var(--sp-2)", color: "var(--color-icon)", display: "flex" }}
        >
          <RefreshCw size={11} className={loading ? "sj-spin" : undefined} />
        </button>
      </div>

      {/* Legend */}
      <div style={{
        display: "flex", gap: "var(--sp-4)", padding: "var(--sp-2) var(--sp-3)",
        borderBottom: "var(--border)", flexShrink: 0, alignItems: "center",
      }}>
        {Object.entries(TYPE_COLOR).map(([type, color]) => (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: "var(--sp-1)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", textTransform: "capitalize" }}>{type}</span>
          </div>
        ))}
        <span style={{ fontSize: 10, color: "var(--color-text-muted)", marginLeft: "auto" }}>
          Hover = connections · Click = detail
        </span>
      </div>

      <div className="sj-panel-body" style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {loading ? (
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center", padding: "var(--sp-6)", width: "100%" }}>
            Loading memory graph…
          </p>
        ) : error ? (
          <p style={{ fontSize: 12, color: "#ef4444", textAlign: "center", padding: "var(--sp-4)", width: "100%" }}>
            {error}
          </p>
        ) : nodes.length === 0 ? (
          <div style={{ textAlign: "center", padding: "var(--sp-6)", width: "100%" }}>
            <div style={{ fontSize: 40, marginBottom: "var(--sp-3)" }}>🧠</div>
            <p style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              No memories yet. Chat with Jazper to build memory.
            </p>
          </div>
        ) : (
          <>
            {/* Graph */}
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }}>
              <svg
                width={SVG_SIZE} height={SVG_SIZE}
                style={{ maxWidth: "100%", maxHeight: "100%", cursor: "default" }}
              >
                {/* Ring guides */}
                {Object.values(TYPE_RING).map(r => (
                  <circle key={r} cx={CX} cy={CY} r={r} fill="none"
                    stroke="var(--color-border)" strokeWidth={1} strokeDasharray="4 6" opacity={0.5} />
                ))}

                {/* Center label */}
                <text x={CX} y={CY} textAnchor="middle" dominantBaseline="middle"
                  style={{ fontSize: 13, fontWeight: 600, letterSpacing: "0.08em" }}
                  fill="var(--color-text-muted)">
                  MEMORY
                </text>

                {/* Connection lines */}
                {hoveredNode && connections.map(target => (
                  <line key={`conn-${target.id}`}
                    x1={hoveredNode.x} y1={hoveredNode.y}
                    x2={target.x} y2={target.y}
                    stroke={TYPE_COLOR[hoveredNode.type]}
                    strokeWidth={1.5} strokeDasharray="5 3" opacity={0.55}
                  />
                ))}

                {/* Nodes */}
                {nodes.map(node => {
                  const isHovered   = node.id === hovered;
                  const isConnected = connectedIds.has(node.id);
                  const isSelected  = selected?.id === node.id;
                  const dimmed      = !!(hovered && !isHovered && !isConnected);
                  const color       = TYPE_COLOR[node.type] || "#888";
                  const r           = isHovered ? NODE_R + 3 : isConnected ? NODE_R + 1 : NODE_R;

                  return (
                    <g key={node.id}
                      onMouseEnter={() => setHovered(node.id)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => setSelected(isSelected ? null : node)}
                      style={{ cursor: "pointer" }}
                    >
                      <circle cx={node.x} cy={node.y} r={r + 4} fill="transparent" />
                      <circle
                        cx={node.x} cy={node.y} r={r}
                        fill={color}
                        fillOpacity={dimmed ? 0.12 : isHovered ? 1 : 0.7}
                        stroke={isSelected ? "#fff" : isConnected ? color : "none"}
                        strokeWidth={isSelected ? 2.5 : isConnected ? 1 : 0}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Detail sidebar */}
            {selected && (
              <div style={{
                width: 220, flexShrink: 0, padding: "var(--sp-3)",
                borderLeft: "var(--border)", overflowY: "auto",
                display: "flex", flexDirection: "column", gap: "var(--sp-2)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: TYPE_COLOR[selected.type],
                  }} />
                  <span style={{
                    fontSize: 11, fontWeight: 600, textTransform: "capitalize",
                    color: TYPE_COLOR[selected.type],
                  }}>
                    {selected.type} memory
                  </span>
                  <button
                    onClick={() => setSelected(null)}
                    style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-muted)", fontSize: 16, padding: 0, lineHeight: 1 }}
                  >×</button>
                </div>

                <p style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.65, margin: 0 }}>
                  {selected.content}
                </p>

                {selected.created_at && (
                  <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: 0 }}>
                    {new Date(selected.created_at).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}
                  </p>
                )}

                {selected.keywords.size > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: "var(--sp-1)" }}>
                    {[...selected.keywords].slice(0, 6).map(kw => (
                      <span key={kw} style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: "var(--r-full)",
                        background: `color-mix(in srgb, ${TYPE_COLOR[selected.type]} 12%, transparent)`,
                        color: TYPE_COLOR[selected.type],
                        border: `1px solid ${TYPE_COLOR[selected.type]}33`,
                      }}>
                        {kw}
                      </span>
                    ))}
                  </div>
                )}

                {connectedIds.size > 0 && (
                  <div style={{ marginTop: "var(--sp-1)" }}>
                    <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "0 0 4px" }}>
                      Related ({connections.length})
                    </p>
                    {connections.slice(0, 3).map(n => (
                      <button
                        key={n.id}
                        onClick={() => setSelected(n)}
                        style={{
                          display: "block", width: "100%", textAlign: "left",
                          background: "none", border: "none", cursor: "pointer",
                          fontSize: 11, color: "var(--color-text-muted)", padding: "2px 0",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.color = "var(--color-text)")}
                        onMouseLeave={e => (e.currentTarget.style.color = "var(--color-text-muted)")}
                      >
                        → {n.content.slice(0, 40)}…
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
