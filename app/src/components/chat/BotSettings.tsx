"use client";

// Bot settings dialog: ID card, system prompt, appearance (colour/body), organisation (group/department/position).
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { MAUS_COLORS, MAUS_COLOR_NAMES, MASCOT_BODY_IDS, MausAvatar, lookFor, useBotLook } from "@/mascot/MausAvatar";
import { ScoreBadge, ago, type OrgBot, type OrgGroup } from "./OrgSidebar";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
type Card = OrgBot & { group: string; group_label: string; prompt: string; prompt_is_default: boolean; memory_namespace: string; has_prompt_override: boolean };
const TABS = ["ID card", "Prompt", "Appearance", "Organisation"] as const;
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

export function BotSettings({ slug, groups, onClose, onChanged }: { slug: string; groups: OrgGroup[]; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("ID card");
  const [card, setCard] = useState<Card | null>(null);
  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState("");
  const looks = useBotLook((s) => s.looks);
  const setLook = useBotLook((s) => s.set);
  const look = lookFor(looks, slug);

  const load = () => fetch(`${API}/api/v1/bots/${slug}/card`).then((r) => r.json()).then((c: Card) => { setCard(c); setPrompt(c.prompt); }).catch(() => undefined);
  useEffect(() => { void load(); }, [slug]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePrompt = async (value: string | null) => {
    await fetch(`${API}/api/v1/bots/${slug}/prompt`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: value }) });
    setSaved(value ? "Saved — applies to the next message" : "Reset to default"); await load(); onChanged();
  };
  const place = async (patch: Record<string, string>) => {
    await fetch(`${API}/api/v1/bots/${slug}/org`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    await load(); onChanged();
  };

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <><span className="opacity-60">{k}</span><span className="break-words">{v}</span></>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div data-testid="bot-settings" role="dialog" aria-label="Bot settings" className="flex max-h-[85vh] w-[560px] flex-col rounded-2xl border border-white/10 bg-[#1b1b1b] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <MausAvatar color={look.color} bodyId={look.body} size={36} />
          <div className="min-w-0"><div className="truncate font-semibold">{look.name ?? card?.display_name ?? slug}</div><div className="truncate text-xs opacity-60">{card?.position}</div></div>
          {card && <ScoreBadge bot={card} />}
          <button onClick={onClose} aria-label="Close" className="ml-auto rounded-full p-1 opacity-60 hover:opacity-100"><X size={16} /></button>
        </div>
        <div className="flex gap-1 border-b border-white/10 px-3 pt-2 text-sm">
          {TABS.map((t) => <button key={t} onClick={() => setTab(t)} className="rounded-t-lg px-3 py-1.5" style={{ background: tab === t ? "rgba(255,255,255,0.1)" : "transparent" }}>{t}</button>)}
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-sm">
          {!card ? <div className="opacity-60">Loading…</div> : tab === "ID card" ? (
            <div data-testid="id-card" className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5">
              <Row k="Slug / ID" v={<span className="font-mono text-xs">{card.slug}</span>} />
              <Row k="Role" v={card.role_title} />
              <Row k="Group" v={card.group_label} />
              <Row k="Department" v={card.department || "—"} />
              <Row k="Reports to" v={card.reports_to || "—"} />
              <Row k="Created" v={fmt(card.created_at)} />
              <Row k="Started working" v={fmt(card.started_at)} />
              <Row k="Lifecycle" v={`${card.enabled ? card.lifecycle ?? "active" : "inactive"} (${card.source})`} />
              <Row k="Model tier" v={card.tier} />
              <Row k="Memory" v={<span className="font-mono text-xs">{card.memory_namespace}</span>} />
              <Row k="Tools" v={card.tools?.length ? card.tools.join(", ") : "none attached"} />
              <div className="col-span-2 mt-2 border-t border-white/10 pt-2 text-xs font-semibold uppercase tracking-wider opacity-60">Performance</div>
              <Row k="Score" v={card.score === null ? "not enough turns yet (needs 3)" : `${card.score} / 100 · ${card.grade}`} />
              <Row k="Turns / errors" v={`${card.calls} / ${card.errors}`} />
              <Row k="Thumbs" v={`👍 ${card.thumbs_up}   👎 ${card.thumbs_down}`} />
              <Row k="Avg latency" v={`${card.avg_latency_ms} ms`} />
              <Row k="Last active" v={ago(card.last_active_at)} />
              <div className="col-span-2 mt-1 text-xs opacity-50">Score = 60% reliability (turns without error) + 40% satisfaction (thumbs on its replies).</div>
            </div>
          ) : tab === "Prompt" ? (
            <div className="space-y-2">
              <div className="text-xs opacity-60">{card.has_prompt_override ? "Custom prompt in use." : "Using the default prompt."} Changes apply from the next message.</div>
              <textarea data-testid="prompt-editor" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12} className="w-full rounded-lg bg-white/10 p-2 font-mono text-xs outline-none" />
              <div className="flex items-center gap-2">
                <button onClick={() => void savePrompt(prompt)} className="rounded-full bg-blue-600 px-4 py-1.5">Save prompt</button>
                <button onClick={() => void savePrompt(null)} className="rounded-full bg-white/10 px-4 py-1.5">Reset to default</button>
                <span className="text-xs text-green-400">{saved}</span>
              </div>
            </div>
          ) : tab === "Appearance" ? (
            <div className="space-y-3">
              <label className="block text-xs opacity-60">Display name</label>
              <input defaultValue={look.name ?? card.display_name} onBlur={(e) => setLook(slug, { name: e.target.value.trim() || undefined })} aria-label="Display name" className="w-full rounded-lg bg-white/10 px-2 py-1.5 outline-none" />
              <div className="flex flex-wrap gap-2">
                {MAUS_COLOR_NAMES.map((c) => <button key={c} title={c} aria-label={`Colour ${c}`} onClick={() => setLook(slug, { color: c })} className="h-6 w-6 rounded-full" style={{ background: MAUS_COLORS[c], outline: look.color === c ? "2px solid #fff" : "none", outlineOffset: 2 }} />)}
              </div>
              <div className="grid grid-cols-5 gap-2">
                {MASCOT_BODY_IDS.map((b) => <button key={b} title={b} aria-label={`Body ${b}`} onClick={() => setLook(slug, { body: b })} className="flex items-center justify-center rounded-lg p-1" style={{ background: look.body === b ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)" }}><MausAvatar color={look.color} bodyId={b} size={32} animated={false} /></button>)}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[130px_1fr] items-center gap-x-3 gap-y-2">
              <span className="opacity-60">Group</span>
              <select value={card.group} onChange={(e) => void place({ org_group: e.target.value })} className="rounded-lg bg-white/10 px-2 py-1.5 outline-none">
                {groups.map((g) => <option key={g.id} value={g.id} className="bg-[#1b1b1b]">{g.label}</option>)}
              </select>
              <span className="opacity-60">Department</span>
              <input defaultValue={card.department} onBlur={(e) => e.target.value !== card.department && void place({ department: e.target.value })} className="rounded-lg bg-white/10 px-2 py-1.5 outline-none" />
              <span className="opacity-60">Position / job role</span>
              <input defaultValue={card.position} onBlur={(e) => e.target.value !== card.position && void place({ position: e.target.value })} className="rounded-lg bg-white/10 px-2 py-1.5 outline-none" />
              <div className="col-span-2 text-xs opacity-50">You can also drag bots in the list to reorder them or move them between groups.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
