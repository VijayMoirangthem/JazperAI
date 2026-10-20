"use client";

// Bot settings dialog: ID card, system prompt, appearance (colour/body), organisation (group/department/position).
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { MAUS_COLORS, MAUS_COLOR_NAMES, MASCOT_BODY_IDS, MausAvatar, lookFor, useBotLook, voiceOf } from "@/mascot/MausAvatar";
import { speakAs, stopSpeaking } from "@/voice/botVoice";
import { ScoreBadge, ago, type OrgBot, type OrgGroup } from "./OrgSidebar";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
type Card = OrgBot & { settings?: Settings; tool_options?: string[]; group: string; group_label: string; prompt: string; prompt_is_default: boolean; memory_namespace: string; has_prompt_override: boolean };
const TABS = ["ID card", "Prompt", "Model", "Behaviour", "Appearance", "Voice", "Organisation"] as const;
interface Prov { slug: string; name: string; enabled: boolean; has_key: boolean; local?: boolean; kind?: string; models: { model_id: string; enabled: boolean }[] }
interface Settings { model?: string; tier?: string; temperature?: number; max_tokens?: number; memory?: boolean; tools_off?: string[]; memory_scopes?: Record<string, boolean>; style?: string; language?: string; daily_token_cap?: number }
const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—");

export function BotSettings({ slug, groups, onClose, onChanged }: { slug: string; groups: OrgGroup[]; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("ID card");
  const [card, setCard] = useState<Card | null>(null);
  const [prompt, setPrompt] = useState("");
  const [saved, setSaved] = useState("");
  const looks = useBotLook((s) => s.looks);
  const setLook = useBotLook((s) => s.set);
  const look = lookFor(looks, slug);
  const [voices, setVoices] = useState<{ name: string; gender: string; locale: string; label: string }[]>([]);
  useEffect(() => { fetch(`${API}/api/v1/voice2/voices`).then((r) => r.json()).then((d) => setVoices(d.voices ?? [])).catch(() => undefined); }, []);
  const voice = voiceOf(looks, slug);
  const [provs, setProvs] = useState<Prov[]>([]);
  const [st, setSt] = useState<Settings>({});
  const [stMsg, setStMsg] = useState("");
  useEffect(() => { fetch(`${API}/api/v1/llm/providers`).then((r) => r.json()).then((d) => setProvs(d.providers ?? [])).catch(() => undefined); }, []);
  useEffect(() => { if (card?.settings) setSt(card.settings); }, [card]);
  const [dupSlug, setDupSlug] = useState("");
  const [wsList, setWsList] = useState<{ org_group: string; path: string; mode: string }[]>([]);
  useEffect(() => { fetch(`${API}/api/v1/workspaces/`).then((r) => r.json()).then((d) => setWsList(d.workspaces ?? [])).catch(() => undefined); }, []);
  const saveBehaviour = async () => {
    const body = { style: st.style ?? null, language: st.language || null, daily_token_cap: st.daily_token_cap ?? null, tools_off: st.tools_off ?? [], memory_scopes: st.memory_scopes ?? { founder: true, own: true, group: true, org: true } };
    const r = await fetch(`${API}/api/v1/bots/${slug}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setStMsg(r.ok ? "Saved — applies from the next message" : "Could not save"); await load(); onChanged();
  };
  const doDuplicate = async () => {
    const r = await fetch(`${API}/api/v1/bots/${slug}/duplicate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_slug: dupSlug }) });
    setStMsg(r.ok ? `Created ${dupSlug}` : "Could not duplicate (slug taken or invalid)"); if (r.ok) { setDupSlug(""); onChanged(); }
  };
  const doExport = async () => {
    const d = await fetch(`${API}/api/v1/bots/${slug}/export`).then((r) => r.json());
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" })); a.download = `${slug}.jasper-bot.json`; a.click();
  };
  const doImport = async (f: File | undefined) => {
    if (!f) return;
    try { const j = JSON.parse(await f.text()); const r = await fetch(`${API}/api/v1/bots/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bot: j.bot, settings: j.settings ?? {}, org: j.org ?? {} }) }); setStMsg(r.ok ? `Imported ${j.bot?.slug}` : "Import failed (bad file or slug taken)"); if (r.ok) onChanged(); } catch { setStMsg("That is not a valid bot file"); }
  };
  const setActive = async (on: boolean) => { await fetch(`${API}/api/v1/bots/${slug}${on ? "/enable" : ""}`, { method: on ? "POST" : "DELETE" }); await load(); onChanged(); };
  const saveSettings = async () => {
    const body = { model: st.model ?? null, tier: st.tier ?? null, temperature: st.temperature ?? null, max_tokens: st.max_tokens ?? null, memory: st.memory ?? null };
    const r = await fetch(`${API}/api/v1/bots/${slug}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setStMsg(r.ok ? "Saved — applies from the next message" : "Could not save"); await load(); onChanged();
  };

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
          ) : tab === "Model" ? (
            <div className="space-y-3" data-testid="model-tab">
              <div className="text-xs opacity-60">Choose which AI model this bot uses. “Automatic” follows the tier routing (with failover). A pinned model is tried first; if it fails, the tier chain takes over.</div>
              <label className="block text-xs opacity-60">Model</label>
              <select value={st.model ?? ""} onChange={(e) => setSt((s) => ({ ...s, model: e.target.value || undefined }))} aria-label="Model" className="w-full rounded-lg bg-white/10 px-2 py-1.5 outline-none">
                <option value="" className="bg-[#1b1b1b]">Automatic (tier routing)</option>
                {provs.filter((p) => p.enabled && (p.has_key || p.local || p.kind === "cli")).map((p) => (
                  <optgroup key={p.slug} label={p.name} className="bg-[#1b1b1b]">
                    {p.models.filter((m) => m.enabled).map((m) => <option key={p.slug + m.model_id} value={`${p.slug}:${m.model_id}`} className="bg-[#1b1b1b]">{m.model_id}</option>)}
                  </optgroup>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs opacity-80">Tier (when automatic)
                  <select value={st.tier ?? ""} onChange={(e) => setSt((s) => ({ ...s, tier: e.target.value || undefined }))} aria-label="Tier" className="mt-1 w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none">
                    <option value="" className="bg-[#1b1b1b]">Default ({card.tier})</option><option value="light" className="bg-[#1b1b1b]">light (fast, cheap)</option><option value="standard" className="bg-[#1b1b1b]">standard</option><option value="frontier" className="bg-[#1b1b1b]">frontier (strongest)</option>
                  </select>
                </label>
                <label className="text-xs opacity-80">Max reply tokens
                  <input type="number" min={64} max={8192} step={64} value={st.max_tokens ?? ""} placeholder="default" onChange={(e) => setSt((s) => ({ ...s, max_tokens: e.target.value ? Number(e.target.value) : undefined }))} aria-label="Max tokens" className="mt-1 w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none" />
                </label>
              </div>
              <label className="block text-xs opacity-80">Creativity (temperature): {st.temperature ?? "default"}
                <input type="range" min={0} max={1.5} step={0.1} value={st.temperature ?? 0.7} onChange={(e) => setSt((s) => ({ ...s, temperature: Number(e.target.value) }))} aria-label="Temperature" className="w-full" />
              </label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={st.memory !== false} onChange={(e) => setSt((s) => ({ ...s, memory: e.target.checked ? undefined : false }))} aria-label="Use memory" />Use memory (founder, own, group and company)</label>
              <div className="flex items-center gap-2">
                <button onClick={() => void saveSettings()} className="rounded-full bg-blue-600 px-4 py-1.5">Save</button>
                <button onClick={() => { setSt({}); setStMsg(""); }} className="rounded-full bg-white/10 px-4 py-1.5">Reset to default</button>
                <span className="text-xs text-green-400">{stMsg}</span>
              </div>
              <div className="text-xs opacity-50">Only providers with a key appear here. Add providers and keys in AI Providers.</div>
            </div>
          ) : tab === "Behaviour" ? (
            <div className="space-y-4" data-testid="behaviour-tab">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs opacity-80">Reply style
                  <select value={st.style ?? ""} onChange={(e) => setSt((s) => ({ ...s, style: e.target.value || undefined }))} aria-label="Reply style" className="mt-1 w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none"><option value="" className="bg-[#1b1b1b]">Default</option><option value="concise" className="bg-[#1b1b1b]">Concise</option><option value="detailed" className="bg-[#1b1b1b]">Detailed</option></select>
                </label>
                <label className="text-xs opacity-80">Reply language
                  <input value={st.language ?? ""} onChange={(e) => setSt((s) => ({ ...s, language: e.target.value || undefined }))} placeholder="default (English)" aria-label="Language" className="mt-1 w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none" />
                </label>
              </div>
              <label className="block text-xs opacity-80">Daily token cap (hard stop for this bot, blank = none)
                <input type="number" min={1000} step={1000} value={st.daily_token_cap ?? ""} onChange={(e) => setSt((s) => ({ ...s, daily_token_cap: e.target.value ? Number(e.target.value) : undefined }))} aria-label="Daily token cap" className="mt-1 w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none" />
              </label>
              <div>
                <div className="mb-1 text-xs opacity-60">Memory this bot may read</div>
                <div className="flex flex-wrap gap-3 text-sm">
                  {(["founder", "own", "group", "org"] as const).map((k) => (
                    <label key={k} className="flex items-center gap-1"><input type="checkbox" aria-label={`Memory ${k}`} checked={(st.memory_scopes ?? {})[k] !== false} onChange={(e) => setSt((s) => ({ ...s, memory_scopes: { founder: true, own: true, group: true, org: true, ...(s.memory_scopes ?? {}), [k]: e.target.checked } }))} />{k === "founder" ? "About you" : k === "own" ? "Its own lessons" : k === "group" ? "Group" : "Company"}</label>
                  ))}
                </div>
              </div>
              {(card.tool_options?.length ?? 0) > 0 && (
                <div>
                  <div className="mb-1 text-xs opacity-60">Tools (untick to switch one off)</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    {card.tool_options!.map((t) => (
                      <label key={t} className="flex items-center gap-1.5 font-mono text-xs"><input type="checkbox" aria-label={`Tool ${t}`} checked={!(st.tools_off ?? []).includes(t)} onChange={(e) => setSt((s) => ({ ...s, tools_off: e.target.checked ? (s.tools_off ?? []).filter((x) => x !== t) : [...(s.tools_off ?? []), t] }))} />{t}</label>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1 text-xs opacity-60">Workspace folders (from its group; edit in Connections)</div>
                {wsList.filter((w) => w.org_group === card.group).length === 0 ? <div className="text-xs opacity-50">None attached{slug === "jasper" ? " — Jasper can read every drive; writes need approval." : "."}</div>
                  : wsList.filter((w) => w.org_group === card.group).map((w) => <div key={w.path} className="font-mono text-xs">{w.path} <span className="opacity-50">({w.mode})</span></div>)}
              </div>
              <div className="flex items-center gap-2"><button onClick={() => void saveBehaviour()} className="rounded-full bg-blue-600 px-4 py-1.5">Save</button><span className="text-xs text-green-400">{stMsg}</span></div>
              <div className="border-t border-white/10 pt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider opacity-50">Bot actions</div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <input value={dupSlug} onChange={(e) => setDupSlug(e.target.value)} placeholder="new-slug" aria-label="Duplicate slug" className="w-40 rounded-lg bg-white/10 px-2 py-1 text-xs outline-none" />
                  <button onClick={() => void doDuplicate()} disabled={!dupSlug} className="rounded-full bg-white/10 px-3 py-1 text-xs disabled:opacity-40">Duplicate</button>
                  <button onClick={() => void doExport()} className="rounded-full bg-white/10 px-3 py-1 text-xs">Export JSON</button>
                  <label className="cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs">Import JSON<input type="file" accept="application/json" hidden onChange={(e) => void doImport(e.target.files?.[0])} /></label>
                  <button onClick={() => void setActive(!card.enabled)} className="rounded-full bg-white/10 px-3 py-1 text-xs">{card.enabled ? "Archive (disable)" : "Enable"}</button>
                </div>
              </div>
            </div>
          ) : tab === "Voice" ? (
            <div className="space-y-3" data-testid="voice-tab">
              <div className="text-xs opacity-60">Natural neural voices (Microsoft Edge TTS): free, no API key, and no LLM tokens are used. Each bot can have its own voice. The text is sent to Microsoft's speech service to be synthesised, so it needs an internet connection.</div>
              <label className="block text-xs opacity-60">Voice</label>
              <select value={voice} onChange={(e) => setLook(slug, { voice: e.target.value })} aria-label="Voice" className="w-full rounded-lg bg-white/10 px-2 py-1.5 outline-none">
                {voices.length === 0 && <option value={voice}>{voice}</option>}
                {voices.map((v) => <option key={v.name} value={v.name} className="bg-[#1b1b1b]">{v.locale} · {v.label} ({v.gender})</option>)}
              </select>
              <div className="flex items-center gap-2">
                <button onClick={() => speakAs(slug, voice, `Hello, I am ${look.name ?? card.display_name}. This is how I sound.`)} className="rounded-full bg-blue-600 px-4 py-1.5">Preview</button>
                <button onClick={stopSpeaking} className="rounded-full bg-white/10 px-4 py-1.5">Stop</button>
              </div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={!!look.autoSpeak} onChange={(e) => setLook(slug, { autoSpeak: e.target.checked })} aria-label="Speak every reply" />Speak every reply automatically</label>
              <div className="text-xs opacity-50">You can also press the speaker icon under any message to hear it, or again to repeat it.</div>
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
