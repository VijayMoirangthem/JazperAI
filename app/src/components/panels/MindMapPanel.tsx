"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/swr";
import type { OrgGroup } from "@/components/chat/OrgSidebar";
import { useViewActive } from "@/lib/viewActive";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
interface Msg { id: number; ts: string; thread: string; from_slug: string; to_slug: string; kind: string; text: string }
interface Conn { id: string; connected: boolean; ready: boolean; missing: string[]; oauth?: { connected: boolean } | null }
interface BotsTreeResponse { groups: OrgGroup[] }
interface ConnectionsResponse { connections: Conn[] }
interface HitlPendingResponse { requests: unknown[] }
interface SloResponse { slos: { slo: string; status: string; budget_remaining: number | null }[] }
interface CommsRecentResponse { messages: Msg[] }
interface CommsAgentsResponse { agents: Record<string, { state: string; bubble?: string }> }

const W = 1000, H = 640, CX = W / 2, CY = H / 2;
const GROUP_COLOR: Record<string, string> = { chief: "#6366f1", jazper_team: "#22c55e", create_origins: "#f59e0b", baeit: "#ec4899", boardmint: "#06b6d4", legacy: "#64748b" };
const STATE_COLOR: Record<string, string> = { working: "#f59e0b", planning: "#a78bfa", idle: "#94a3b8", error: "#ef4444", blocked: "#ef4444" };

export function MindMapPanel() {
  const active = useViewActive();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [states, setStates] = useState<Record<string, { state: string; bubble?: string }>>({});
  const [showLegacy, setShowLegacy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [lastMsgId, setLastMsgId] = useState(0);

  const { data: botsTree, loading: botsLoading } = useApi<BotsTreeResponse>(`${API}/api/v1/bots/tree`, { ttl: 8000, poll: active ? 8000 : false });
  const { data: connections, loading: connsLoading } = useApi<ConnectionsResponse>(`${API}/api/v1/connections/`, { ttl: 5000, poll: active ? 5000 : false });
  const { data: hitl, loading: hitlLoading } = useApi<HitlPendingResponse>(`${API}/api/v1/hitl/pending`, { ttl: 5000, poll: active ? 5000 : false });
  const { data: slo, loading: sloLoading } = useApi<SloResponse>(`${API}/api/v1/slo/`, { ttl: 5000, poll: active ? 5000 : false });

  const groups = botsTree?.groups ?? [];
  const conns = connections?.connections ?? [];
  const pending = hitl?.requests?.length ?? 0;
  const slos = slo?.slos ?? [];

  useEffect(() => {
    if (!active) return;
    let stop = false;
    let last = lastMsgId;

    const fast = async () => {
      try {
        const [m, a] = await Promise.all([
          fetch(`${API}/api/v1/comms/recent?since_id=${last}&limit=120`).then(r => r.json()),
          fetch(`${API}/api/v1/comms/agents`).then(r => r.json()),
        ]);
        if (stop) return;
        const fresh: Msg[] = m.messages ?? [];
        if (fresh.length) {
          last = fresh[fresh.length - 1].id;
          setLastMsgId(last);
          setMsgs((x) => [...x, ...fresh].slice(-150));
        }
        setStates(a.agents ?? {});
        setNow(Date.now());
      } catch { /* backend busy */ }
    };

    void fast();
    const b = setInterval(fast, 2000);
    return () => { stop = true; clearInterval(b); };
  }, [active]);

  const layout = useMemo(() => {
    const pos: Record<string, { x: number; y: number; group: string; name: string; enabled: boolean }> = {};
    const gs = groups.filter((g) => g.id !== "chief" && (showLegacy || g.id !== "legacy")).map((g) => ({ ...g, bots: g.bots.filter((b) => b.enabled || showLegacy) })).filter((g) => g.bots.length);
    const jasper = groups.find((g) => g.id === "chief")?.bots[0];
    if (jasper) pos[jasper.slug] = { x: CX, y: CY, group: "chief", name: jasper.display_name, enabled: true };
    const labels: { id: string; label: string; x: number; y: number }[] = [];
    gs.forEach((g, gi) => {
      const ang = (gi / gs.length) * Math.PI * 2 - Math.PI / 2;
      const gx = CX + Math.cos(ang) * 235, gy = CY + Math.sin(ang) * 205;
      labels.push({ id: g.id, label: g.label, x: gx, y: gy });
      const n = g.bots.length, r = Math.min(150, 30 + n * 11);
      g.bots.forEach((b, i) => {
        const a = (i / n) * Math.PI * 2 + ang;
        pos[b.slug] = { x: gx + Math.cos(a) * r * (n === 1 ? 0 : 1) + Math.cos(ang) * 55, y: gy + Math.sin(a) * r * (n === 1 ? 0 : 1) * 0.8 + Math.sin(ang) * 40, group: g.id, name: b.display_name, enabled: b.enabled };
      });
    });
    return { pos, labels };
  }, [groups, showLegacy]);

  const recent = msgs.filter((m) => now - new Date(m.ts).getTime() < 90_000);
  const edges = new Map<string, { a: string; b: string; age: number; kind: string }>();
  for (const m of recent) {
    const to = m.to_slug.startsWith("tool:") || m.to_slug.startsWith("meeting:") ? "" : m.to_slug;
    if (to && layout.pos[m.from_slug] && layout.pos[to]) edges.set([m.from_slug, to].sort().join("|"), { a: m.from_slug, b: to, age: (now - new Date(m.ts).getTime()) / 1000, kind: m.kind });
  }
  const toolNow = new Map<string, string>();
  for (const m of recent.slice(-30)) if (m.to_slug.startsWith("tool:") && m.kind === "tool") toolNow.set(m.from_slug, m.to_slug.slice(5));

  return (
    <div className="flex h-full min-h-[560px] flex-col" data-testid="mind-map">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-xs">
        <span className="font-semibold">Mind map</span>
        {conns.map((c) => <span key={c.id} title={c.missing.length ? "missing " + c.missing.join(", ") : c.oauth && !c.oauth.connected ? "needs Google sign-in" : c.connected ? "connected" : "not tested"}
          className="rounded-full border border-white/10 px-2 py-0.5" style={{ color: c.connected ? "#22c55e" : c.ready ? "#eab308" : "#94a3b8" }}>● {c.id}</span>)}
        <span className="ml-auto flex items-center gap-3 opacity-80">
          <span style={{ color: pending ? "#f59e0b" : undefined }}>approvals pending: {pending}</span>
          {slos.map((s) => <span key={s.slo} style={{ color: s.status === "breached" ? "#ef4444" : undefined }}>SLO {s.slo}: {s.status}{s.budget_remaining !== null ? ` (${Math.round(s.budget_remaining * 100)}%)` : ""}</span>)}
          <label className="flex items-center gap-1"><input type="checkbox" checked={showLegacy} onChange={(e) => setShowLegacy(e.target.checked)} />legacy/inactive</label>
        </span>
      </div>
      <div className="flex min-h-0 flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="min-w-0 flex-1" role="img" aria-label="Bot network map">
          <style>{`@keyframes mm-pulse{0%{opacity:.35;r:9}50%{opacity:1}100%{opacity:.35}} .mm-working{animation:mm-pulse 1.1s ease-in-out infinite} @keyframes mm-flow{to{stroke-dashoffset:-24}} .mm-edge{stroke-dasharray:6 6;animation:mm-flow 1s linear infinite}`}</style>
          {layout.labels.map((l) => <text key={l.id} x={l.x} y={l.y - 78} textAnchor="middle" fontSize="12" fill={GROUP_COLOR[l.id] ?? "#94a3b8"} fontWeight="600">{l.label}</text>)}
          {Object.entries(layout.pos).filter(([, p]) => p.group !== "chief").map(([s, p]) => <line key={"s" + s} x1={CX} y1={CY} x2={p.x} y2={p.y} stroke="#ffffff" strokeOpacity="0.06" />)}
          {[...edges.values()].map((e) => <line key={e.a + e.b} className="mm-edge" x1={layout.pos[e.a].x} y1={layout.pos[e.a].y} x2={layout.pos[e.b].x} y2={layout.pos[e.b].y}
            stroke={e.kind === "ask" ? "#60a5fa" : "#34d399"} strokeWidth="2.5" strokeOpacity={Math.max(0.25, 1 - e.age / 90)} />)}
          {Object.entries(layout.pos).map(([slug, p]) => {
            const st = states[slug]?.state ?? "idle";
            const big = slug === "jasper";
            return (
              <g key={slug} data-testid={"node-" + slug} opacity={p.enabled ? 1 : 0.4}>
                <title>{`${p.name}: ${st}${states[slug]?.bubble ? " — " + states[slug].bubble : ""}`}</title>
                <circle className={st === "working" ? "mm-working" : ""} cx={p.x} cy={p.y} r={big ? 20 : 11} fill={GROUP_COLOR[p.group] ?? "#64748b"} stroke={STATE_COLOR[st] ?? "#94a3b8"} strokeWidth={st === "idle" ? 1 : 3} />
                <text x={p.x} y={p.y + (big ? 34 : 24)} textAnchor="middle" fontSize={big ? 12 : 9.5} fill="#e5e7eb">{p.name.length > 16 ? p.name.slice(0, 15) + "…" : p.name}</text>
                {toolNow.has(slug) && <text x={p.x} y={p.y - 17} textAnchor="middle" fontSize="9" fill="#fb923c">⚙ {toolNow.get(slug)}</text>}
              </g>
            );
          })}
        </svg>
        <aside className="w-[300px] shrink-0 overflow-y-auto border-l border-white/10 p-3 text-xs" data-testid="mm-feed">
          <div className="mb-2 font-semibold opacity-80">Happening now</div>
          {msgs.length === 0 && <div className="opacity-50">No bot activity yet. Ask Jasper something in Chat.</div>}
          {[...msgs].reverse().slice(0, 40).map((m) => (
            <div key={m.id} className="mb-1.5 rounded-lg bg-white/5 px-2 py-1.5">
              <div className="opacity-60">{new Date(m.ts).toLocaleTimeString()} · <b className="text-white/90">{m.from_slug}</b> → {m.to_slug} · {m.kind}</div>
              <div className="line-clamp-2 break-words">{m.text}</div>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}