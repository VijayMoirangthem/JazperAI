"use client";

// Tabbed views for the Command Center hub: Floor (2D), Activity, Messages,
// Tasks, and Terminals. The existing 3D scene stays as its own tab.

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Building2, Send, Route as RouteIcon, Plus, ChevronRight, Mail,
  Inbox, TerminalSquare, Radio, CircleDot, ArrowRight,
} from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useHive } from "@/hooks/useHive";
import type { ActivityEntry } from "@/stores/agentStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const OfficeFloor = dynamic(() => import("@/scene/office/OfficeFloor"), {
  ssr: false,
  loading: () => (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0a0a12", color: "#333355", flexDirection: "column", gap: 12 }}>
      <Building2 size={36} />
      <span style={{ fontSize: 12, letterSpacing: "0.1em" }}>BOOTING OFFICE FLOOR…</span>
    </div>
  ),
});

const STATUS_DOT: Record<string, string> = {
  active: "#10b981", standby: "#f59e0b", inactive: "#475569", error: "#ef4444",
  idle: "#6b7a9a", thinking: "#8b5cf6", working: "#10b981", blocked: "#ef4444",
  success: "#22c55e", compacting: "#eab308", looping: "#f59e0b", offline: "#475569",
};

const ACT_COLOR: Record<string, string> = {
  request: "#f59e0b", inform: "#3b82f6", propose: "#10b981", query: "#8b5cf6",
  agree: "#22c55e", refuse: "#ef4444", done: "#06b6d4",
};

// ── Floor ────────────────────────────────────────────────────────────────────

export function FloorView() {
  const { agents, departments, selectedAgentId, setSelectedAgent } = useAgentStore();

  const depts = useMemo(() => {
    return departments.filter(d => agents.some(a => a.department === d.id));
  }, [departments, agents]);

  return (
    <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
      <OfficeFloor />

      {/* dept + agent rail */}
      <div style={{
        position: "absolute", top: 10, right: 10, bottom: 10, width: 210,
        background: "rgba(13,13,20,0.85)", border: "1px solid var(--color-border)",
        borderRadius: 10, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6,
        backdropFilter: "blur(6px)",
      }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)", padding: "4px 6px" }}>
          Fleet — {agents.filter(a => a.status === "active").length}/{agents.length} online
        </div>
        {depts.map(d => (
          <div key={d.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 6px" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: d.badge_color, flexShrink: 0 }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-secondary)" }}>{d.name}</span>
            </div>
            {agents.filter(a => a.department === d.id).map(a => {
              const sel = a.agent_id === selectedAgentId;
              return (
                <button
                  key={a.agent_id}
                  onClick={() => setSelectedAgent(sel ? null : a.agent_id)}
                  style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "4px 8px",
                    borderRadius: 6, border: sel ? "1px solid var(--color-border-hi)" : "1px solid transparent",
                    background: sel ? "rgba(255,255,255,0.07)" : "none", cursor: "pointer", textAlign: "left", width: "100%",
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_DOT[a.status] ?? "#475569", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: sel ? 700 : 500, color: "var(--color-text-primary)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.codename}
                  </span>
                  <span style={{ fontSize: 9, color: "var(--color-text-dim)", textTransform: "uppercase" }}>
                    {a.runtime_status ?? a.status}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* legend */}
      <div style={{
        position: "absolute", bottom: 10, left: 10,
        background: "rgba(13,13,20,0.8)", border: "1px solid var(--color-border)",
        borderRadius: 8, padding: "6px 10px", fontSize: 9, color: "var(--color-text-dim)",
        display: "flex", gap: 10, alignItems: "center", backdropFilter: "blur(6px)",
      }}>
        <span><span style={{ color: "#10b981" }}>●</span> working</span>
        <span><span style={{ color: "#8b5cf6" }}>●</span> thinking</span>
        <span><span style={{ color: "#ef4444" }}>●</span> blocked</span>
        <span><span style={{ color: "#eab308" }}>●</span> looping</span>
        <span style={{ color: "var(--color-text-muted)" }}>click an agent to focus</span>
      </div>
    </div>
  );
}

// ── Activity ─────────────────────────────────────────────────────────────────

export function ActivityView() {
  const { activities } = useAgentStore();
  const { board, setBoardText, route, dispatch, loading, error } = useHive();
  const [filter, setFilter] = useState("");
  const [boardDraft, setBoardDraft] = useState(board?.board ?? "");
  const [dispAgent, setDispAgent] = useState("jazper");
  const [dispTask, setDispTask] = useState("");
  const [dispBusy, setDispBusy] = useState(false);
  const [dispMsg, setDispMsg] = useState<string | null>(null);

  const list = useMemo(
    () => activities.filter(a => !filter || (a.agent ?? "").toLowerCase().includes(filter.toLowerCase())),
    [activities, filter]
  );

  const kindColor: Record<string, string> = {
    status: "#8b5cf6", tool: "#3b82f6", cmd: "#06b6d4", message: "#f59e0b",
    dispatch: "#10b981", system: "#64748b",
  };

  return (
    <div style={{ display: "flex", gap: 10, padding: 10, flex: 1, overflow: "hidden" }}>
      {/* feed */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Radio size={13} color="var(--color-accent)" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)" }}>
            Live Activity
          </span>
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="filter by agent…"
            style={{ marginLeft: "auto", width: 160, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 3, background: "var(--color-card-inner)", borderRadius: 8, padding: 8 }}>
          {list.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center", padding: 30 }}>
              No activity yet — dispatch a task or chat with an agent.
            </div>
          )}
          {list.map(a => (
            <div key={a.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0", borderBottom: "1px solid var(--color-border-lo)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: kindColor[a.kind] ?? "#64748b", marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--color-text-primary)", wordBreak: "break-word" }}>
                  {a.agent && <span style={{ color: kindColor[a.kind] ?? "#3b82f6", fontWeight: 700 }}>@{a.agent}</span>}
                  {" "}{a.text}
                </div>
                <div style={{ fontSize: 9, color: "var(--color-text-muted)" }}>
                  {a.kind} · {new Date(a.ts).toLocaleTimeString()}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* board + dispatch */}
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto" }}>
        {error && <div style={{ fontSize: 10, color: "#ef4444" }}>{error}</div>}

        <div style={{ background: "var(--color-card-inner)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)" }}>
            <Building2 size={12} /> Mission Board
          </div>
          <textarea
            value={boardDraft}
            onChange={e => setBoardDraft(e.target.value)}
            rows={5}
            style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: 8, fontSize: 11, color: "var(--color-text-primary)", resize: "none", outline: "none", lineHeight: 1.5 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setBoardText(boardDraft)}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: "var(--color-cta-bg)", color: "var(--color-cta-text)", border: "none", borderRadius: 6, padding: "5px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
            >
              <SaveIcon size={12} /> Save Board
            </button>
            <button
              onClick={route}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: "var(--color-surface-raised)", color: "var(--color-text-secondary)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 10px", fontSize: 11, cursor: "pointer" }}
              title="Route outboxes → inboxes"
            >
              <RouteIcon size={12} /> Route
            </button>
          </div>
        </div>

        <div style={{ background: "var(--color-card-inner)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)" }}>
            <Send size={12} /> Jazper Dispatch
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={dispAgent}
              onChange={e => setDispAgent(e.target.value)}
              style={{ width: 110, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }}
            />
            <input
              value={dispTask}
              onChange={e => setDispTask(e.target.value)}
              placeholder="task for the agent…"
              style={{ flex: 1, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }}
            />
          </div>
          <button
            disabled={!dispTask || dispBusy}
            onClick={async () => {
              setDispBusy(true); setDispMsg(null);
              try {
                const r = await dispatch(dispAgent, dispTask);
                setDispMsg(typeof r.result === "string" ? r.result : JSON.stringify(r.result));
              } catch (e: any) {
                setDispMsg(`dispatch failed: ${e?.message ?? e}`);
              } finally { setDispBusy(false); }
            }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: "var(--color-cta-bg)", color: "var(--color-cta-text)", border: "none", borderRadius: 6, padding: "6px 0", fontSize: 11, fontWeight: 700, cursor: dispBusy ? "wait" : "pointer", opacity: dispBusy ? 0.6 : 1 }}
          >
            {dispBusy ? "Dispatching…" : <><Send size={12} /> Dispatch</>}
          </button>
          {dispMsg && (
            <div style={{ fontSize: 10, color: "var(--color-text-secondary)", background: "var(--color-surface)", borderRadius: 6, padding: 6, maxHeight: 140, overflowY: "auto", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
              {dispMsg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SaveIcon({ size }: { size?: number }) {
  return <span style={{ fontSize: size ?? 12, lineHeight: 1 }}>💾</span>;
}

// ── Messages ────────────────────────────────────────────────────────────────

export function MessagesView() {
  const { messages, agents } = useAgentStore();
  const { sendMessage, refreshState } = useHive();
  const [to, setTo] = useState("jazper");
  const [act, setAct] = useState("request");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const agentOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const m of messages) { if (m.from_codename) codes.add(m.from_codename); if (m.to_codename) codes.add(m.to_codename); }
    for (const a of agents) codes.add(a.codename);
    return Array.from(codes).sort();
  }, [messages, agents]);

  return (
    <div style={{ display: "flex", gap: 10, padding: 10, flex: 1, overflow: "hidden" }}>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Inbox size={13} color="var(--color-accent)" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)" }}>
            Fleet Mailbox ({messages.length})
          </span>
          <button onClick={refreshState} style={{ marginLeft: "auto", background: "none", border: "1px solid var(--color-border)", borderRadius: 6, padding: "3px 8px", fontSize: 10, color: "var(--color-text-dim)", cursor: "pointer" }}>
            Refresh
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5, background: "var(--color-card-inner)", borderRadius: 8, padding: 8 }}>
          {messages.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", textAlign: "center", padding: 30 }}>
              No messages yet — compose one to an agent.
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} style={{ display: "flex", gap: 8, padding: 8, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 7 }}>
              <Mail size={13} color={ACT_COLOR[m.act] ?? "#3b82f6"} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-primary)" }}>
                    {m.from_codename ?? m.from} → {m.to_codename ?? m.to}
                  </span>
                  <span style={{ fontSize: 9, color: ACT_COLOR[m.act] ?? "#3b82f6", textTransform: "uppercase", fontWeight: 700 }}>{m.act}</span>
                  {!m.read && <span style={{ fontSize: 8, background: "var(--color-cta-bg)", color: "var(--color-cta-text)", borderRadius: 4, padding: "1px 5px", fontWeight: 700 }}>NEW</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-primary)", fontWeight: 600, marginTop: 2 }}>{m.subject}</div>
                {m.body && <div style={{ fontSize: 10.5, color: "var(--color-text-secondary)", marginTop: 1, wordBreak: "break-word" }}>{m.body}</div>}
                <div style={{ fontSize: 9, color: "var(--color-text-muted)", marginTop: 3 }}>{new Date(m.ts).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* composer */}
      <div style={{ width: 300, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ background: "var(--color-card-inner)", borderRadius: 8, padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)" }}>
            Compose
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input list="hive-agents" value={to} onChange={e => setTo(e.target.value)} placeholder="to…" style={{ flex: 1, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }} />
            <datalist id="hive-agents">
              {agentOptions.map(c => <option key={c} value={c} />)}
            </datalist>
            <select value={act} onChange={e => setAct(e.target.value)} style={{ width: 90, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 6px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }}>
              {["request", "inform", "propose", "query", "agree", "refuse", "done"].map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="subject" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 8px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }} />
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} placeholder="message body…" style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: 8, fontSize: 11, color: "var(--color-text-primary)", resize: "none", outline: "none" }} />
          <button
            disabled={!to || !subject}
            onClick={async () => {
              await sendMessage(to, subject, body, act);
              setSent(`sent to @${to}`);
              setSubject(""); setBody("");
              setTimeout(() => setSent(null), 3000);
            }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, background: "var(--color-cta-bg)", color: "var(--color-cta-text)", border: "none", borderRadius: 6, padding: "6px 0", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            <Send size={12} /> Send
          </button>
          {sent && <div style={{ fontSize: 10, color: "#10b981" }}>{sent}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Tasks ───────────────────────────────────────────────────────────────────

const COLUMNS = ["todo", "in_progress", "review", "done"];

export function TasksView() {
  const { tasks, addTask, moveTask } = useHive();
  const { agents } = useAgentStore();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 10, flex: 1, overflow: "hidden" }}>
      {/* add task */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Plus size={13} color="var(--color-accent)" />
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="new task…"
          style={{ flex: 1, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 10px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }}
        />
        <select value={assignee} onChange={e => setAssignee(e.target.value)} style={{ width: 130, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "5px 6px", fontSize: 11, color: "var(--color-text-primary)", outline: "none" }}>
          <option value="">assignee…</option>
          {agents.map(a => <option key={a.codename} value={a.codename}>{a.codename}</option>)}
        </select>
        <button
          disabled={!title}
          onClick={() => { addTask({ title, assignee }); setTitle(""); }}
          style={{ background: "var(--color-cta-bg)", color: "var(--color-cta-text)", border: "none", borderRadius: 6, padding: "5px 14px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
        >
          Add
        </button>
      </div>

      {/* kanban */}
      <div style={{ flex: 1, display: "flex", gap: 8, overflowX: "auto" }}>
        {COLUMNS.map(col => (
          <div key={col} style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6, background: "var(--color-card-inner)", borderRadius: 8, padding: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--color-text-dim)" }}>
              {col.replace("_", " ")} · {tasks.filter(t => t.status === col).length}
            </div>
            {tasks.filter(t => t.status === col).map(t => (
              <div key={t.id} style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 7, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ fontSize: 11, color: "var(--color-text-primary)", fontWeight: 600, wordBreak: "break-word" }}>{t.title}</div>
                <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                  {t.assignee && <span style={{ fontSize: 9, color: "#3b82f6", fontWeight: 700 }}>@{t.assignee}</span>}
                  <span style={{ fontSize: 9, color: t.priority === "high" ? "#ef4444" : t.priority === "low" ? "#64748b" : "#f59e0b" }}>{t.priority}</span>
                </div>
                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                  {col !== "todo" && (
                    <button onClick={() => moveTask(t.id, COLUMNS[COLUMNS.indexOf(col) - 1])} style={{ fontSize: 9, background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 5, padding: "2px 6px", color: "var(--color-text-dim)", cursor: "pointer" }}>
                      ←
                    </button>
                  )}
                  {col !== "done" && (
                    <button onClick={() => moveTask(t.id, COLUMNS[COLUMNS.indexOf(col) + 1])} style={{ fontSize: 9, background: "var(--color-surface-raised)", border: "1px solid var(--color-border)", borderRadius: 5, padding: "2px 6px", color: "var(--color-text-dim)", cursor: "pointer" }}>
                      →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Terminals ───────────────────────────────────────────────────────────────

export function TerminalsView() {
  const { agents, activities } = useAgentStore();
  const { execTerminal } = useHive();
  const [sel, setSel] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);

  const selAgent = agents.find(a => a.codename === sel);
  const feed = useMemo(
    () => activities.filter(a => (a.agent ?? "").toLowerCase() === (sel ?? "").toLowerCase()).slice(0, 200),
    [activities, sel]
  );

  return (
    <div style={{ display: "flex", gap: 10, padding: 10, flex: 1, overflow: "hidden" }}>
      <div style={{ width: 190, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)", padding: "4px 6px" }}>
          Agent Terminals
        </div>
        {agents.map(a => (
          <button
            key={a.agent_id}
            onClick={() => setSel(a.codename)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", borderRadius: 6,
              background: sel === a.codename ? "rgba(255,255,255,0.07)" : "none",
              border: "1px solid transparent", cursor: "pointer", textAlign: "left",
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_DOT[a.runtime_status ?? a.status] ?? "#475569", flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: "var(--color-text-primary)" }}>{a.codename}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TerminalSquare size={13} color="var(--color-accent)" />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--color-text-dim)" }}>
            {sel ? `@${sel} — workspace terminal` : "select an agent"}
          </span>
          <CircleDot size={11} color={selAgent ? (selAgent.status === "active" ? "#10b981" : "#f59e0b") : "#475569"} style={{ marginLeft: "auto" }} />
        </div>

        <div
          style={{
            flex: 1, background: "#07070c", border: "1px solid var(--color-border)", borderRadius: 8,
            overflowY: "auto", padding: 10, fontFamily: '"JetBrains Mono", monospace', fontSize: 11, lineHeight: 1.6,
            display: "flex", flexDirection: "column", gap: 1,
          }}
        >
          {!sel && <div style={{ color: "#334155", padding: 20, fontSize: 11 }}>Pick an agent from the list to open its workspace terminal.</div>}
          {sel && feed.length === 0 && <div style={{ color: "#334155", padding: 20, fontSize: 11 }}>@ {sel} workspace — no activity yet. Run a command below.</div>}
          {feed.map(a => (
            <div key={a.id} style={{ color: kindColorFor(a.kind), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              <span style={{ color: "#475569" }}>{new Date(a.ts).toLocaleTimeString()} </span>
              {a.text}
            </div>
          ))}
          {sel && busy && <div style={{ color: "#f59e0b" }}>▍</div>}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ fontSize: 11, color: "#10b981", fontFamily: '"JetBrains Mono", monospace', padding: "6px 0" }}>❯</span>
          <input
            value={cmd}
            onChange={e => setCmd(e.target.value)}
            onKeyDown={async e => {
              if (e.key === "Enter" && cmd.trim() && sel && !busy) {
                setBusy(true);
                try { await execTerminal(sel, cmd.trim()); } finally { setBusy(false); }
                setCmd("");
              }
            }}
            disabled={!sel}
            placeholder={sel ? `run a command in @${sel}'s workspace…` : "select an agent first"}
            style={{ flex: 1, background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "6px 10px", fontSize: 11, fontFamily: '"JetBrains Mono", monospace', color: "var(--color-text-primary)", outline: "none" }}
          />
        </div>
      </div>
    </div>
  );
}

function kindColorFor(kind: string): string {
  return {
    status: "#8b5cf6", tool: "#3b82f6", cmd: "#06b6d4", message: "#f59e0b",
    dispatch: "#10b981", system: "#64748b",
  }[kind] ?? "#94a3b8";
}