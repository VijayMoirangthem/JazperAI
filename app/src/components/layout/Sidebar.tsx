"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, Puzzle, Plus, X, Check, ChevronRight, ChevronDown, Bot, Archive } from "lucide-react";
import { useApprovals } from "@/hooks/useApprovals";
import {
  SYSTEM_REGISTRY,
  PLUGIN_REGISTRY,
  SIDEBAR_BOTTOM,
  DYNAMIC_ICON_MAP,
  getSystemTools,
  loadPinnedTools,
  savePinnedTools,
  isPinnedByDefault,
  CORE_PINNED,
  MAX_USER_PINS,
  type PluginMeta,
  type DynamicPluginMeta,
  type SystemMeta,
} from "@/app/plugin-registry";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Nav button (pinned strip) ──────────────────────────────────────────────────
function PinnedButton({
  item,
  isActive,
  onClick,
  badge,
  showBadge,
  onRemove,
  isCore,
}: {
  item: PluginMeta;
  isActive: boolean;
  onClick: () => void;
  badge?: number;
  showBadge?: boolean;
  onRemove?: () => void;
  isCore?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        className={`sj-nav-icon${isActive ? " active" : ""}`}
        onClick={onClick}
        title={item.label}
      >
        <item.icon size={16} />
        {showBadge && badge && badge > 0 ? (
          <span style={{
            position: "absolute", top: 4, right: 4,
            background: "#f87171", color: "#fff",
            fontSize: 8, fontWeight: 700, borderRadius: "50%",
            width: 12, height: 12,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            {badge > 9 ? "9+" : badge}
          </span>
        ) : null}
      </button>
      {/* Remove pin button on hover (only for non-core) */}
      {hovered && !isCore && onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Unpin"
          style={{
            position: "absolute", top: -4, right: -4,
            width: 14, height: 14, borderRadius: "50%",
            background: "var(--color-surface-float)",
            border: "1px solid var(--color-border-hi)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", zIndex: 10,
            color: "var(--color-text-muted)",
          }}
        >
          <X size={8} />
        </button>
      )}
    </div>
  );
}

// ── System icon button ─────────────────────────────────────────────────────────
function SystemButton({
  system,
  isActive,
  isOsMode,
  onClick,
}: {
  system: SystemMeta;
  isActive: boolean;
  isOsMode: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={system.label}
      style={{
        width: 36, height: 36, borderRadius: "var(--r-md)",
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "pointer", border: "1px solid transparent",
        background: isActive ? `${system.color}22` : "transparent",
        borderColor: isActive ? `${system.color}55` : "transparent",
        color: isActive ? system.color : "var(--color-icon)",
        transition: "all 0.15s ease",
        position: "relative",
      }}
      onMouseEnter={e => {
        if (!isActive) {
          (e.currentTarget as HTMLButtonElement).style.background = `${system.color}11`;
          (e.currentTarget as HTMLButtonElement).style.color = system.color;
        }
      }}
      onMouseLeave={e => {
        if (!isActive) {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--color-icon)";
        }
      }}
    >
      <system.icon size={16} />
      {/* Active indicator dot */}
      {isActive && (
        <span style={{
          position: "absolute", right: 3, top: "50%", transform: "translateY(-50%)",
          width: 3, height: 12, borderRadius: 2,
          background: system.color,
        }} />
      )}
    </button>
  );
}

// ── Jazper ordering (by importance) + Setup only until finished ────────────────
const JAZPER_ORDER = ["team_chat", "mind_map", "live_agents", "office", "org_chart", "dev_loop", "diff_editor", "connections", "skills", "mcp_hub", "ai_providers", "finops", "business", "system", "setup"];

function setupDone(): boolean {
  try { return localStorage.getItem("jasper.setupDone") === "1"; } catch { return false; }
}

function orderJazperTools(tools: PluginMeta[], systemId: string): PluginMeta[] {
  if (systemId !== "jazper") return tools;
  const rank = (id: string) => { const i = JAZPER_ORDER.indexOf(id); return i < 0 ? 99 : i; };
  return tools.filter(t => !(t.id === "setup" && setupDone())).sort((x, y) => rank(x.id) - rank(y.id));
}

// ── Legacy flyout: all previous-version panels in collapsed groups ─────────────
function LegacyFlyout({ active, onNavigate, onClose, badges }: {
  active: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
  badges: Record<string, number>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const groups: { id: string; label: string; tools: PluginMeta[] }[] = [
    { id: "core", label: "Core (old)", tools: PLUGIN_REGISTRY.filter(p => p.group === "pinned" || p.group === "bottom" && p.id === "roadmap") },
    ...SYSTEM_REGISTRY.filter(s => s.id !== "jazper").map(s => ({ id: s.id, label: s.label, tools: getSystemTools(s.id) })),
  ].filter(g => g.tools.length > 0);

  return (
    <div ref={ref} data-testid="legacy-flyout" style={{
      position: "fixed", left: 60, top: 0, bottom: 0, width: 280, zIndex: 200,
      background: "var(--color-surface)", borderRight: "1px solid var(--color-border)",
      display: "flex", flexDirection: "column", overflowY: "auto",
    }}>
      <div style={{ padding: "14px 14px 8px", fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
        Legacy
        <div style={{ fontSize: 11, fontWeight: 400, color: "var(--color-text-muted)" }}>Previous-version panels (kept until the audit is approved)</div>
      </div>
      <div style={{ padding: "0 8px 16px" }}>
        {groups.map(g => (
          <div key={g.id}>
            <button
              onClick={() => setOpenGroup(p => p === g.id ? null : g.id)}
              data-testid={"legacy-group-" + g.id}
              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: "7px 8px", background: "transparent", border: "none", color: "var(--color-text-secondary)", fontSize: 12, cursor: "pointer", textAlign: "left" }}
            >
              {openGroup === g.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {g.label}
              <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)" }}>{g.tools.length}</span>
            </button>
            {openGroup === g.id && g.tools.map(t => (
              <button
                key={t.id}
                onClick={() => onNavigate(t.id)}
                title={t.description}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px 6px 26px",
                  background: active === t.id ? "var(--color-surface-raised)" : "transparent",
                  border: "none", color: active === t.id ? "var(--color-text-primary)" : "var(--color-text-muted)",
                  fontSize: 12, cursor: "pointer", textAlign: "left",
                }}
              >
                <t.icon size={13} />
                {t.label}
                {t.badge && badges[t.badge] > 0 && <span style={{ marginLeft: "auto", fontSize: 10, color: "#ef4444" }}>{badges[t.badge]}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── System Flyout Panel ────────────────────────────────────────────────────────
function SystemFlyout({
  system,
  tools,
  active,
  onNavigate,
  pinnedIds,
  onTogglePin,
  onClose,
}: {
  system: SystemMeta;
  tools: PluginMeta[];
  active: string;
  onNavigate: (id: string) => void;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  onClose: () => void;
}) {
  const flyoutRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (flyoutRef.current && !flyoutRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={flyoutRef}
      style={{
        position: "fixed",
        left: 60,
        top: 0,
        bottom: 0,
        width: 280,
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        zIndex: 200,
        animation: "sj-flyout-in 0.18s ease",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "16px 16px 12px",
        borderBottom: "1px solid var(--color-border)",
        display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${system.color}22`,
          border: `1px solid ${system.color}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: system.color,
        }}>
          <system.icon size={15} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
            {system.label}
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 1 }}>
            {system.description}
          </div>
        </div>
        <button onClick={onClose} style={{
          width: 24, height: 24, borderRadius: 6, border: "none",
          background: "transparent", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "var(--color-text-muted)",
        }}>
          <X size={13} />
        </button>
      </div>

      {/* Coordinator agent chip */}
      <div style={{ padding: "8px 12px 4px", flexShrink: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 10px", borderRadius: 6,
          background: "var(--color-surface-raised)",
          border: "1px solid var(--color-border)",
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: "50%",
            background: `${system.color}33`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 8, fontWeight: 700, color: system.color,
            textTransform: "uppercase",
          }}>
            {system.coordinatorAgent.charAt(0)}
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            Coordinator: <span style={{ color: "var(--color-text-secondary)", fontWeight: 500 }}>
              {system.coordinatorAgent.charAt(0).toUpperCase() + system.coordinatorAgent.slice(1)}
            </span>
          </div>
          <div style={{ marginLeft: "auto" }}>
            <div style={{
              fontSize: 9, fontWeight: 500, padding: "1px 6px", borderRadius: 10,
              background: `${system.color}22`, color: system.color, border: `1px solid ${system.color}44`,
            }}>
              {system.primaryAgents.length} agents
            </div>
          </div>
        </div>
      </div>

      {/* Tools label */}
      <div style={{
        padding: "8px 14px 4px",
        fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
        color: "var(--color-text-muted)", flexShrink: 0,
      }}>
        Tools
      </div>

      {/* Tool list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 16px" }}>
        {tools.map(tool => {
          const isToolActive = active === tool.id;
          const isPinned = pinnedIds.includes(tool.id);
          const isCorePin = isPinnedByDefault(tool.id);

          return (
            <div
              key={tool.id}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "6px 8px", borderRadius: 7, marginBottom: 2,
                background: isToolActive ? `${system.color}18` : "transparent",
                border: `1px solid ${isToolActive ? system.color + "33" : "transparent"}`,
                cursor: "pointer",
                transition: "all 0.12s ease",
              }}
              onClick={() => { onNavigate(tool.id); onClose(); }}
              onMouseEnter={e => {
                if (!isToolActive) {
                  (e.currentTarget as HTMLDivElement).style.background = "var(--color-surface-raised)";
                }
              }}
              onMouseLeave={e => {
                if (!isToolActive) {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }
              }}
            >
              {/* Tool icon */}
              <div style={{
                width: 28, height: 28, borderRadius: 6,
                background: isToolActive ? `${system.color}22` : "var(--color-surface-raised)",
                border: `1px solid ${isToolActive ? system.color + "44" : "var(--color-border)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: isToolActive ? system.color : "var(--color-icon)",
                flexShrink: 0,
              }}>
                <tool.icon size={13} />
              </div>

              {/* Tool label + desc */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 500,
                  color: isToolActive ? "var(--color-text-primary)" : "var(--color-text-secondary)",
                  lineHeight: 1.3,
                }}>
                  {tool.label}
                </div>
                {tool.description && (
                  <div style={{
                    fontSize: 10, color: "var(--color-text-muted)",
                    lineHeight: 1.3, marginTop: 1,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {tool.description}
                  </div>
                )}
              </div>

              {/* Pin button */}
              {!isCorePin && (
                <button
                  onClick={e => { e.stopPropagation(); onTogglePin(tool.id); }}
                  title={isPinned ? "Unpin from sidebar" : "Pin to sidebar"}
                  style={{
                    width: 22, height: 22, borderRadius: 4, border: "1px solid",
                    borderColor: isPinned ? `${system.color}66` : "var(--color-border)",
                    background: isPinned ? `${system.color}22` : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", flexShrink: 0,
                    color: isPinned ? system.color : "var(--color-text-muted)",
                    transition: "all 0.12s ease",
                  }}
                >
                  {isPinned ? <Check size={10} /> : <Plus size={10} />}
                </button>
              )}

              {/* Active chevron */}
              {isToolActive && (
                <ChevronRight size={11} style={{ color: system.color, flexShrink: 0 }} />
              )}
            </div>
          );
        })}

        {tools.length === 0 && (
          <div style={{
            textAlign: "center", padding: "24px 16px",
            fontSize: 12, color: "var(--color-text-muted)",
          }}>
            No tools in this system yet
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pin Picker (+ button flyout) ───────────────────────────────────────────────
function PinPicker({
  pinnedIds,
  onToggle,
  onClose,
}: {
  pinnedIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const allTools = PLUGIN_REGISTRY.filter(p =>
    p.sidebar !== false &&
    !isPinnedByDefault(p.id) &&
    p.group !== "bottom"
  );

  const filtered = query
    ? allTools.filter(t => t.label.toLowerCase().includes(query.toLowerCase()) ||
        t.description?.toLowerCase().includes(query.toLowerCase()))
    : allTools;

  // Group by system
  const grouped: Record<string, PluginMeta[]> = {};
  for (const tool of filtered) {
    const key = tool.system ?? "other";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(tool);
  }

  const userPins = pinnedIds.filter(id => !isPinnedByDefault(id));
  const canPin = userPins.length < MAX_USER_PINS;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        left: 60,
        bottom: 80,
        width: 300,
        maxHeight: 480,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border-hi)",
        borderRadius: 10,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        zIndex: 300,
        boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        animation: "sj-scale-in 0.15s ease",
      }}
    >
      {/* Header */}
      <div style={{
        padding: "10px 12px 8px",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-primary)" }}>
            Pin Tools to Sidebar
          </span>
          <div style={{ fontSize: 10, color: "var(--color-text-muted)" }}>
            {userPins.length}/{MAX_USER_PINS} pinned
          </div>
        </div>
        <input
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search tools…"
          style={{
            width: "100%", height: 30, borderRadius: 6,
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border-hi)",
            padding: "0 10px", fontSize: 12,
            color: "var(--color-text-primary)", outline: "none",
            fontFamily: "var(--font-sans)",
          }}
        />
      </div>

      {/* Tool list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
        {Object.entries(grouped).map(([systemId, tools]) => {
          const sys = SYSTEM_REGISTRY.find(s => s.id === systemId);
          return (
            <div key={systemId}>
              {sys && (
                <div style={{
                  fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
                  color: sys.color, padding: "6px 6px 3px",
                }}>
                  {sys.label}
                </div>
              )}
              {tools.map(tool => {
                const pinned = pinnedIds.includes(tool.id);
                return (
                  <div
                    key={tool.id}
                    onClick={() => { if (!pinned || !isPinnedByDefault(tool.id)) onToggle(tool.id); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 6px", borderRadius: 6, marginBottom: 1,
                      cursor: (!canPin && !pinned) ? "not-allowed" : "pointer",
                      opacity: (!canPin && !pinned) ? 0.4 : 1,
                      transition: "all 0.1s",
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLDivElement).style.background = "var(--color-surface-raised)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    <div style={{
                      width: 24, height: 24, borderRadius: 5,
                      background: "var(--color-surface-raised)",
                      border: "1px solid var(--color-border)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: sys?.color ?? "var(--color-icon)",
                      flexShrink: 0,
                    }}>
                      <tool.icon size={12} />
                    </div>
                    <span style={{
                      flex: 1, fontSize: 12, color: "var(--color-text-secondary)",
                    }}>
                      {tool.label}
                    </span>
                    <div style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: pinned ? (sys?.color ?? "#6366f1") + "33" : "transparent",
                      border: `1px solid ${pinned ? (sys?.color ?? "#6366f1") + "66" : "var(--color-border)"}`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: pinned ? (sys?.color ?? "#6366f1") : "var(--color-text-muted)",
                    }}>
                      {pinned ? <Check size={9} /> : <Plus size={9} />}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "20px 0", fontSize: 12, color: "var(--color-text-muted)" }}>
            No tools found
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dynamic plugin button ─────────────────────────────────────────────────────
function DynamicNavButton({
  item, isActive, onClick,
}: { item: DynamicPluginMeta; isActive: boolean; onClick: () => void }) {
  const Icon = DYNAMIC_ICON_MAP[item.icon] ?? Puzzle;
  return (
    <button
      className={`sj-nav-icon${isActive ? " active" : ""}`}
      onClick={onClick}
      title={item.label}
    >
      <Icon size={16} />
    </button>
  );
}

// ── Main Sidebar ───────────────────────────────────────────────────────────────

interface SidebarProps {
  active: string;
  onNavigate: (id: string) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  const [mounted,         setMounted]        = useState(false);
  const [jobsBadge,       setJobsBadge]      = useState(0);
  const [notifBadge,      setNotifBadge]     = useState(0);
  const [dynamicPlugins,  setDynamicPlugins] = useState<DynamicPluginMeta[]>([]);
  const [openSystem,      setOpenSystem]     = useState<string | null>(null);
  const [showPinPicker,   setShowPinPicker]  = useState(false);
  const [osMode,          setOsMode]         = useState(false);
  const [pinnedIds,       setPinnedIds]      = useState<string[]>([]);

  const { pending: pendingApprovals } = useApprovals();
  const approvalBadge = pendingApprovals.length;

  // Init
  useEffect(() => {
    setMounted(true);
    setPinnedIds(loadPinnedTools());
  }, []);

  useEffect(() => {
    fetch(`${API}/api/plugins`)
      .then(r => r.json())
      .then(setDynamicPlugins)
      .catch(() => {});
  }, []);

  // Badge polling
  const fetchBadges = useCallback(async () => {
    try {
      const [jr, nr] = await Promise.all([
        fetch(`${API}/api/jobs/notifications/unread-count`),
        fetch(`${API}/api/notifications/unread-count`),
      ]);
      const [jd, nd] = await Promise.all([jr.json(), nr.json()]);
      setJobsBadge(jd.count ?? 0);
      setNotifBadge(nd.count ?? 0);
    } catch { /* backend offline */ }
  }, []);

  useEffect(() => {
    fetchBadges();
    const id = setInterval(fetchBadges, 30_000);
    return () => clearInterval(id);
  }, [fetchBadges]);

  // Badge lookup
  function getBadge(id: string): number {
    if (id === "notifications") return notifBadge;
    if (id === "jobs")          return jobsBadge;
    if (id === "approvals")     return approvalBadge;
    return 0;
  }

  // Pin management
  function togglePin(id: string) {
    setPinnedIds(prev => {
      let next: string[];
      if (prev.includes(id)) {
        next = prev.filter(p => p !== id);
      } else {
        const userPins = prev.filter(p => !CORE_PINNED.includes(p as typeof CORE_PINNED[number]));
        if (userPins.length >= MAX_USER_PINS) return prev;
        next = [...prev, id];
      }
      savePinnedTools(next);
      return next;
    });
  }

  function unpin(id: string) {
    setPinnedIds(prev => {
      const next = prev.filter(p => p !== id);
      savePinnedTools(next);
      return next;
    });
  }

  // System click — toggle flyout
  function handleSystemClick(systemId: string) {
    setShowPinPicker(false);
    setOpenSystem(prev => prev === systemId ? null : systemId);
  }

  // Nav — close flyout
  function navigate(id: string) {
    onNavigate(id);
    setOpenSystem(null);
    setShowPinPicker(false);
  }

  // Visible systems — Agent OS (IDE, agents, evolution, etc.) shown inline with the rest
  const userSystems = SYSTEM_REGISTRY;
  const openSystemMeta = openSystem && openSystem !== "legacy" ? SYSTEM_REGISTRY.find(s => s.id === openSystem) : null;
  const openSystemTools = openSystem && openSystem !== "legacy" ? orderJazperTools(getSystemTools(openSystem as Parameters<typeof getSystemTools>[0]), openSystem) : [];

  return (
    <>
      <nav className="sj-sidebar" style={{ gap: 0, padding: "12px 0", justifyContent: "flex-start" }}>

        {/* ── Logo / JZ ───────────────────────────────────────────────── */}
        <div className="sj-logo" style={{ marginBottom: 10, marginTop: 2, cursor: "pointer" }}
          onClick={() => navigate("dashboard")} title="Sir Jazper OS">
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>JZ</span>
        </div>

        {/* ── Jazper tools, directly on the rail ──────────────────────── */}
        <div className="sj-nav-divider" style={{ width: 28 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center", width: "100%", padding: "8px 10px", overflowY: "auto", minHeight: 0 }}>
          {orderJazperTools(getSystemTools("jazper"), "jazper").map(item => (
            <button
              key={item.id}
              className={`sj-nav-icon${active === item.id ? " active" : ""}`}
              title={item.label}
              data-testid={"rail-" + item.id}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={16} />
            </button>
          ))}
        </div>

        {/* ── Spacer ──────────────────────────────────────────────────── */}
        <div style={{ flex: 1 }} />

        {/* ── Dynamic plugins ─────────────────────────────────────────── */}
        {dynamicPlugins.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center", padding: "0 10px 6px" }}>
            {dynamicPlugins.map(item => (
              <DynamicNavButton
                key={item.id}
                item={item}
                isActive={active === item.id}
                onClick={() => navigate(item.id)}
              />
            ))}
          </div>
        )}

        {/* ── Divider ─────────────────────────────────────────────────── */}
        <div className="sj-nav-divider" style={{ width: 28 }} />

        {/* ── Legacy (everything from the previous version) ───────────── */}
        <div style={{ padding: "4px 10px", display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
          <button
            className="sj-nav-icon"
            title="Legacy — previous version panels"
            data-testid="legacy-button"
            onClick={() => handleSystemClick("legacy")}
            style={openSystem === "legacy" ? { background: "var(--color-surface-raised)", color: "var(--color-text-secondary)" } : {}}
          >
            <Archive size={14} />
          </button>

          {/* ── Bottom items (roadmap, settings) ───────────────────────── */}
          {SIDEBAR_BOTTOM.map(item => (
            <button
              key={item.id}
              className={`sj-nav-icon${active === item.id ? " active" : ""}`}
              onClick={() => navigate(item.id)}
              title={item.label}
            >
              <item.icon size={14} />
            </button>
          ))}

          {/* ── User avatar ─────────────────────────────────────────────── */}
          <div className="sj-avatar" style={{ marginTop: 4 }}>VJ</div>
        </div>
      </nav>

      {/* ── System Flyout ─────────────────────────────────────────────────── */}
      {openSystem === "legacy" && (
        <LegacyFlyout active={active} onNavigate={navigate} onClose={() => setOpenSystem(null)} badges={{ notifications: notifBadge, jobs: jobsBadge, approvals: approvalBadge }} />
      )}
      {openSystemMeta && (
        <SystemFlyout
          system={openSystemMeta}
          tools={openSystemTools}
          active={active}
          onNavigate={navigate}
          pinnedIds={pinnedIds}
          onTogglePin={togglePin}
          onClose={() => setOpenSystem(null)}
        />
      )}

      {/* ── Pin Picker ────────────────────────────────────────────────────── */}
      {showPinPicker && (
        <PinPicker
          pinnedIds={pinnedIds}
          onToggle={togglePin}
          onClose={() => setShowPinPicker(false)}
        />
      )}
    </>
  );
}
