"use client";

// Left list of the Chat panel: bots grouped by organisation (Jazper Team, companies...), hover info card,
// drag & drop to reorder / move between groups. Layout follows Project_References/OpenMausBot's bot list.
import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Hash, Search } from "lucide-react";
import { MausAvatar, lookFor, useBotLook, type MausState } from "@/mascot/MausAvatar";
import { threadTitle, type CommsThread } from "./CommsView";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface OrgBot {
  slug: string; display_name: string; role_title: string; crew: string; reports_to?: string; enabled: boolean; source: string; lifecycle?: string;
  department: string; position: string; sort_order: number; created_at?: string; started_at?: string;
  score: number | null; grade: string; calls: number; errors: number; thumbs_up: number; thumbs_down: number; avg_latency_ms: number; last_active_at?: string;
  tier?: string; tools?: string[];
}
export interface OrgGroup { id: string; label: string; kind: string; sort_order: number; bots: OrgBot[] }
export interface RoomRow { id: string; label: string }

const GRADE_COLOR: Record<string, string> = { good: "#22c55e", ok: "#eab308", "needs-attention": "#ef4444", new: "#64748b" };
export const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export function ScoreBadge({ bot }: { bot: Pick<OrgBot, "score" | "grade"> }) {
  return <span className="rounded-full px-1.5 py-px text-[10px] font-semibold" style={{ background: GRADE_COLOR[bot.grade] + "33", color: GRADE_COLOR[bot.grade] }}>{bot.score ?? "new"}</span>;
}

function HoverCard({ bot, groupLabel, state, top }: { bot: OrgBot; groupLabel: string; state: string; top: number }) {
  return (
    <div data-testid="bot-hover-card" className="pointer-events-none fixed z-40 w-72 space-y-1.5 rounded-2xl border border-white/10 bg-[#1b1b1b] p-3 text-xs shadow-2xl" style={{ left: 360, top: Math.max(8, Math.min(top, window.innerHeight - 230)) }}>
      <div className="flex items-center gap-2"><span className="text-sm font-semibold">{bot.display_name}</span><ScoreBadge bot={bot} /><span className="ml-auto opacity-60">{state}</span></div>
      <div className="opacity-90">{bot.position || bot.role_title}</div>
      <div className="grid grid-cols-[72px_1fr] gap-x-2 gap-y-0.5 opacity-70">
        <span>Group</span><span>{groupLabel}</span>
        <span>Department</span><span>{bot.department || "—"}</span>
        <span>Reports to</span><span>{bot.reports_to || "—"}</span>
        <span>Status</span><span>{bot.enabled ? bot.lifecycle ?? "active" : "inactive"} · {bot.source}</span>
        <span>Activity</span><span>{bot.calls} turns · {bot.errors} errors · {ago(bot.last_active_at)}</span>
      </div>
    </div>
  );
}

export function OrgSidebar({ comms = [], groups, rooms, activeId, query, onQuery, onSelect, faceFor, lastOf, unreadOf, nameOf, onChanged }: {
  comms?: CommsThread[]; groups: OrgGroup[]; rooms: RoomRow[]; activeId: string; query: string; onQuery: (q: string) => void; onSelect: (id: string, label: string, kind: "dm" | "room" | "comms", crew?: string) => void;
  faceFor: (channelId: string) => MausState; lastOf: (channelId: string) => { text: string; ts: number } | undefined; unreadOf: (channelId: string) => boolean;
  nameOf: (slug: string, fallback: string) => string; onChanged: () => void;
}) {
  const looks = useBotLook((s) => s.looks);
  const [closed, setClosed] = useState<Record<string, boolean>>({ legacy: true });
  const [hover, setHover] = useState<{ bot: OrgBot; group: string; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  const move = async (slug: string, toGroup: string, beforeSlug: string | null) => {
    const target = groups.find((g) => g.id === toGroup);
    if (!target) return;
    const bots = target.bots.filter((b) => b.slug !== slug);
    const moved = groups.flatMap((g) => g.bots).find((b) => b.slug === slug);
    if (!moved) return;
    const idx = beforeSlug ? bots.findIndex((b) => b.slug === beforeSlug) : -1;
    bots.splice(idx < 0 ? bots.length : idx, 0, moved);
    await fetch(`${API}/api/v1/bots/order`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bots.map((b, i) => ({ slug: b.slug, org_group: toGroup, sort_order: (i + 1) * 10 }))) });
    onChanged();
  };

  const row = (g: OrgGroup, b: OrgBot) => {
    const id = `dm:${b.slug}`;
    const lm = lastOf(id);
    const look = lookFor(looks, b.slug);
    return (
      <button key={b.slug} draggable data-testid={"chan-" + id}
        onClick={() => onSelect(id, b.display_name, "dm")}
        onDragStart={(e) => { setDragging(b.slug); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", b.slug); setHover(null); }}
        onDragEnd={() => { setDragging(null); setOver(null); }}
        onDragOver={(e) => { e.preventDefault(); setOver(b.slug); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); if (dragging && dragging !== b.slug) void move(dragging, g.id, b.slug); setOver(null); }}
        onMouseEnter={(e) => { const top = e.currentTarget.getBoundingClientRect().top; timer.current = setTimeout(() => setHover({ bot: b, group: g.label, top }), 350); }}
        onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setHover(null); }}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left"
        style={{ background: activeId === id ? "rgba(255,255,255,0.09)" : "transparent", opacity: b.enabled ? 1 : 0.5, borderTop: over === b.slug && dragging ? "2px solid #3b82f6" : "2px solid transparent" }}>
        <MausAvatar color={look.color} bodyId={look.body} size={32} state={faceFor(id)} label={b.display_name} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold">{nameOf(b.slug, b.display_name)}</span>
            {lm && <span className="ml-auto shrink-0 text-[11px] opacity-50">{hhmm(lm.ts)}</span>}
          </span>
          <span className="block truncate text-[12px] opacity-55">{lm ? lm.text.replace(/\s+/g, " ") : b.position || b.role_title}</span>
        </span>
        {unreadOf(id) && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
      </button>
    );
  };

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/10 bg-black/20">
      <div className="p-3">
        <label className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-sm">
          <Search size={14} className="opacity-50" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search" aria-label="Search chats" className="w-full bg-transparent outline-none placeholder:opacity-50" />
        </label>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.map((g) => {
          const bots = g.bots.filter((b) => !q || `${b.display_name} ${b.role_title} ${b.department} ${b.slug}`.toLowerCase().includes(q));
          if (!bots.length) return null;
          const open = q ? true : !closed[g.id];
          return (
            <div key={g.id} data-testid={"group-" + g.id}
              onDragOver={(e) => { e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (dragging) void move(dragging, g.id, null); }}>
              <button onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))} className="flex w-full items-center gap-1 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider opacity-60">
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{g.label}<span className="ml-auto font-normal opacity-70">{bots.length}</span>
              </button>
              {open && bots.map((b) => row(g, b))}
            </div>
          );
        })}
        {rooms.filter((r) => !q || r.label.toLowerCase().includes(q)).length > 0 && (
          <div>
            <button onClick={() => setClosed((c) => ({ ...c, rooms: !c.rooms }))} className="flex w-full items-center gap-1 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider opacity-60">
              {closed.rooms ? <ChevronRight size={12} /> : <ChevronDown size={12} />}Rooms
            </button>
            {!closed.rooms && rooms.filter((r) => !q || r.label.toLowerCase().includes(q)).map((r) => (
              <button key={r.id} onClick={() => onSelect(r.id, r.label, "room", r.id.replace("room:", ""))} data-testid={"chan-" + r.id}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left" style={{ background: activeId === r.id ? "rgba(255,255,255,0.09)" : "transparent" }}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10"><Hash size={14} /></span>
                <span className="truncate text-[14px] font-semibold">{r.label}</span>
                {unreadOf(r.id) && <span className="ml-auto h-2 w-2 rounded-full bg-blue-500" />}
              </button>
            ))}
          </div>
        )}
        {comms.filter((c) => !q || threadTitle(c.thread).toLowerCase().includes(q)).length > 0 && (
          <div data-testid="comms-section">
            <button onClick={() => setClosed((c) => ({ ...c, comms: !c.comms }))} className="flex w-full items-center gap-1 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider opacity-60">
              {closed.comms ? <ChevronRight size={12} /> : <ChevronDown size={12} />}Bot conversations<span className="ml-auto font-normal opacity-70">{comms.length}</span>
            </button>
            {!closed.comms && comms.filter((c) => !q || threadTitle(c.thread).toLowerCase().includes(q)).map((c) => (
              <button key={c.thread} onClick={() => onSelect("comms:" + c.thread, threadTitle(c.thread), "comms")} data-testid={"chan-comms:" + c.thread}
                className="flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left" style={{ background: activeId === "comms:" + c.thread ? "rgba(255,255,255,0.09)" : "transparent" }}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-[11px]">&#8644;</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold">{threadTitle(c.thread)}</span>
                  <span className="block truncate text-[12px] opacity-55">{c.preview}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-sm">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-xs">VJ</span>You
      </div>
      {hover && <HoverCard bot={hover.bot} groupLabel={hover.group} state={faceFor(`dm:${hover.bot.slug}`)} top={hover.top} />}
    </aside>
  );
}
