"use client";

// Chat UI modelled on Project_References/OpenMausBot: bot list with animated mascots, pill composer,
// per-bot customisation (colour + body), mascot faces that follow what the bot is doing.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowDown, Check, CheckCheck, ChevronDown, ChevronRight, Copy, Hand, Hash, Mic, Paperclip, Pencil, Search, SendHorizontal, ShieldCheck, Square, X } from "lucide-react";
import { readNdjson } from "@/chat/ndjson";
import { firstUnreadIndex, useChat, type ApprovalLevel, type Attachment, type ChatMessage } from "@/chat/chatStore";
import { useTranscriptViewport } from "@/chat/useTranscriptViewport";
import { RpcClient } from "@/lib/rpcClient";
import { SentenceSplitter, speakable } from "@/voice/audio";
import { Speaker } from "@/voice/speaker";
import { useVoiceMode } from "@/voice/useVoiceMode";
import { useLiveAgents } from "@/stores/liveAgentsStore";
import { MAUS_COLORS, MAUS_COLOR_NAMES, MASCOT_BODY_IDS, MausAvatar, lookFor, stateFromAgent, useBotLook, type MausMotion, type MausState } from "@/mascot/MausAvatar";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";
const uid = () => Math.random().toString(36).slice(2, 10);

interface Bot { slug: string; display_name: string; role_title: string; crew: string; enabled: boolean }
interface Channel { id: string; label: string; kind: "dm" | "room"; crew?: string }
interface Pending { request_id: string; tier: number; action: string; summary: string; requester: string }

const ROOMS: Channel[] = [
  { id: "room:create_origins", label: "Create Origins HQ", kind: "room" },
  { id: "room:baeit", label: "Baeit Engineering", kind: "room", crew: "baeit" },
  { id: "room:boardmint", label: "Boardmint Compliance", kind: "room", crew: "boardmint" },
];
const LEVELS: [ApprovalLevel, string][] = [["ask", "Ask"], ["auto_edits", "Auto-accept edits"], ["approve_for_me", "Approve for me"], ["full", "Full access"]];
const LEVEL_SHORT: Record<ApprovalLevel, string> = { ask: "Ask", auto_edits: "Edits", approve_for_me: "Auto", full: "Full" };

interface AskSpec { question: string; options: string[] }
function parseAsk(block: string): AskSpec | null {
  try { const j = JSON.parse(block.replace(/^```asks*/, "").replace(/```$/, "")); return Array.isArray(j.options) && j.question ? j : null; } catch { return null; }
}
function AskCard({ ask, onAnswer }: { ask: AskSpec; onAnswer?: (t: string) => void }) {
  return (
    <div role="group" aria-label="Question" className="my-2 rounded-2xl bg-black/30 px-3 py-2 ring-1 ring-white/15">
      <div className="mb-2 text-sm font-semibold">{ask.question}</div>
      <div className="flex flex-wrap gap-2">
        {ask.options.slice(0, 6).map((o) => <button key={o} onClick={() => onAnswer?.(o)} className="rounded-full bg-white/10 px-3 py-1 text-xs hover:bg-white/20">{o}</button>)}
      </div>
    </div>
  );
}
function Rich({ text, onAnswer }: { text: string; onAnswer?: (t: string) => void }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((p, i) => p.startsWith("```ask") && parseAsk(p) ? <AskCard key={i} ask={parseAsk(p)!} onAnswer={onAnswer} /> : p.startsWith("```")
        ? <pre key={i} className="my-2 overflow-x-auto rounded-lg bg-black/40 p-2 text-xs font-mono">{p.replace(/^```\w*\n?/, "").replace(/```$/, "")}</pre>
        : <span key={i} className="whitespace-pre-wrap">{p}</span>)}
    </>
  );
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Bubble({ m, onAnswer }: { m: ChatMessage; onAnswer?: (t: string) => void }) {
  const mine = m.from === "you";
  const system = m.from === "system";
  return (
    <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[78%] rounded-[20px] px-4 py-2.5 text-[15px] leading-snug"
        style={{ background: mine ? "#5c5c5c" : system ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)" }}>
        {!mine && !system && m.meta?.route && <div className="mb-0.5 text-[11px] opacity-50">{m.from} · routed by {m.meta.route.source}</div>}
        {m.attachments?.map((a) => a.dataUrl && a.mime.startsWith("image/")
          ? <img key={a.name} src={a.dataUrl} alt={a.name} className="mb-1 max-h-48 rounded-lg" />
          : a.dataUrl && a.mime.startsWith("audio/")
            ? <audio key={a.name} controls src={a.dataUrl} className="mb-1 h-8" />
            : <div key={a.name} className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-xs"><Paperclip size={11} />{a.name}</div>)}
        <Rich text={m.text || (m.streaming ? "…" : "")} onAnswer={m.streaming ? undefined : onAnswer} />
        <div className="mt-0.5 flex items-center justify-end gap-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-60">
          <button title="Copy" onClick={() => navigator.clipboard?.writeText(m.text)}><Copy size={11} /></button>
          {hhmm(m.ts)}
          {mine && (m.status === "read" ? <CheckCheck size={12} /> : <Check size={12} />)}
        </div>
      </div>
    </div>
  );
}

function ApprovalCard({ p, onDone }: { p: Pending; onDone: () => void }) {
  const respond = (approve: boolean) =>
    fetch(`${API}/api/v1/hitl/${p.request_id}/respond`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve, by: "founder" }) })
      .finally(onDone);
  return (
    <div role="group" aria-label="Approval request" className="w-full max-w-[600px] space-y-2 rounded-3xl bg-white/5 px-4 py-3 ring-1 ring-amber-400/40">
      <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} className="text-amber-400" />Approval needed · Tier {p.tier}<span className="ml-auto text-xs opacity-60">{p.requester}</span></div>
      <div className="text-sm"><span className="font-mono text-xs opacity-70">{p.action}</span><div>{p.summary}</div></div>
      <div className="flex gap-2">
        <button onClick={() => respond(true)} className="rounded-full bg-green-600 px-4 py-1 text-sm">Approve</button>
        <button onClick={() => respond(false)} className="rounded-full bg-white/10 px-4 py-1 text-sm">Deny</button>
      </div>
    </div>
  );
}

/** Colour + body picker, saved per bot. Click Pencil in the chat header. */
function CustomizePopover({ slug, name, onClose }: { slug: string; name: string; onClose: () => void }) {
  const looks = useBotLook((s) => s.looks);
  const setLook = useBotLook((s) => s.set);
  const look = lookFor(looks, slug);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [onClose]);
  return (
    <div ref={ref} data-testid="customize-popover" className="absolute left-4 top-14 z-30 w-72 space-y-3 rounded-2xl border border-white/10 bg-[#1b1b1b] p-3 shadow-xl">
      <div className="flex items-center gap-2 text-sm font-semibold">Customize {look.name ?? name}</div>
      <input defaultValue={look.name ?? name} onBlur={(e) => setLook(slug, { name: e.target.value.trim() || undefined })} aria-label="Display name"
        className="w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none" />
      <div className="flex flex-wrap gap-2">
        {MAUS_COLOR_NAMES.map((c) => (
          <button key={c} title={c} aria-label={`Colour ${c}`} onClick={() => setLook(slug, { color: c })}
            className="h-6 w-6 rounded-full" style={{ background: MAUS_COLORS[c], outline: look.color === c ? "2px solid #fff" : "none", outlineOffset: 2 }} />
        ))}
      </div>
      <div className="grid grid-cols-5 gap-2">
        {MASCOT_BODY_IDS.map((b) => (
          <button key={b} title={b} aria-label={`Body ${b}`} onClick={() => setLook(slug, { body: b })}
            className="flex items-center justify-center rounded-lg p-1" style={{ background: look.body === b ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.05)" }}>
            <MausAvatar color={look.color} bodyId={b} size={30} animated={false} />
          </button>
        ))}
      </div>
    </div>
  );
}

function Composer({ channel, label, members, onSend, busy, onStop, level, onLevel, rec, onRec }: {
  channel: string; label: string; members: Bot[]; onSend: (text: string, atts: Attachment[]) => void; busy: boolean; onStop: () => void;
  level: ApprovalLevel | null; onLevel: (l: ApprovalLevel) => void; rec: boolean; onRec: (addFiles: (f: File[]) => Promise<void>, setText: (fn: (t: string) => string) => void) => void;
}) {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [menu, setMenu] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mention = /(?:^|\s)@([\w.-]*)$/.exec(text);
  const options = mention ? members.filter((b) => b.slug.startsWith(mention[1].toLowerCase())).slice(0, 5) : [];

  const addFiles = async (files: FileList | File[]) => {
    const out: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 8)) {
      const a: Attachment = { name: f.name, mime: f.type, size: f.size };
      if (f.type.startsWith("text/") || /\.(md|json|py|ts|tsx|js|css|html|txt|csv|yml|yaml|toml|sql|sh)$/i.test(f.name)) a.text = (await f.text()).slice(0, 200_000);
      if (f.type.startsWith("image/") || f.type.startsWith("audio/")) a.dataUrl = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(f); });
      out.push(a);
    }
    setAtts((x) => [...x, ...out]);
  };
  const submit = () => {
    if (!text.trim() && !atts.length) return;
    if (text.trim() === "/clear") { useChat.getState().clear(channel); setText(""); return; }
    onSend(text.trim(), atts); setText(""); setAtts([]);
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); };

  return (
    <div className="relative px-5 pb-4 pt-2" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {atts.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {atts.map((a) => (
            <span key={a.name} className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs">
              {a.dataUrl && a.mime.startsWith("image/") && <img src={a.dataUrl} alt="" className="h-5 w-5 rounded-full object-cover" />}{a.name}
              <button onClick={() => setAtts((x) => x.filter((y) => y !== a))}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <div role="listbox" className="mb-1 rounded-xl border border-white/10 bg-[#1b1b1b] p-1 text-sm">
          {options.map((b) => <button key={b.slug} role="option" className="block w-full rounded-lg px-2 py-1 text-left hover:bg-white/10"
            onClick={() => setText(text.replace(/@[\w.-]*$/, `@${b.slug} `))}>@{b.slug} <span className="opacity-50">{b.role_title}</span></button>)}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-2">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} title="Attach" className="rounded-full p-1.5 opacity-70 hover:opacity-100"><Paperclip size={17} /></button>
        {level && (
          <div className="relative">
            <button onClick={() => setMenu((v) => !v)} title="Approval level for this bot" data-testid="approval-mode" className="flex items-center gap-1 rounded-full px-2 py-1 text-sm opacity-80 hover:bg-white/10">
              <Hand size={14} />{LEVEL_SHORT[level]}
            </button>
            {menu && (
              <div className="absolute bottom-9 left-0 z-20 w-48 rounded-xl border border-white/10 bg-[#1b1b1b] p-1 text-sm shadow-xl">
                {LEVELS.map(([v, l]) => <button key={v} onClick={() => { onLevel(v); setMenu(false); }} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/10">{l}{level === v && <Check size={13} />}</button>)}
              </div>
            )}
          </div>
        )}
        <textarea value={text} rows={Math.min(6, text.split("\n").length)} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder={`Message ${label}`} aria-label="Message"
          className="flex-1 resize-none bg-transparent py-1 text-[15px] outline-none placeholder:opacity-50" />
        <button onClick={() => onRec(addFiles, setText)} title={rec ? "Stop recording" : "Voice note"} className="rounded-full p-1.5 opacity-70 hover:opacity-100" style={{ color: rec ? "#ef4444" : undefined }}><Mic size={17} /></button>
        {busy
          ? <button onClick={onStop} title="Stop" className="rounded-full bg-white/20 p-1.5"><Square size={15} /></button>
          : <button onClick={submit} title="Send" className="rounded-full bg-white/20 p-1.5 hover:bg-white/30"><SendHorizontal size={15} /></button>}
      </div>
    </div>
  );
}

export function ChatPanel2() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [active, setActive] = useState<Channel>({ id: "dm:jasper", label: "Sir Jasper", kind: "dm" });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [query, setQuery] = useState("");
  const [botsOpen, setBotsOpen] = useState(true);
  const [roomsOpen, setRoomsOpen] = useState(true);
  const [customize, setCustomize] = useState(false);
  const [motion, setMotion] = useState<{ m: MausMotion; k: number }>({ m: "arrive", k: 0 });
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  const kick = (m: MausMotion) => setMotion((p) => ({ m, k: p.k + 1 }));
  // voice conversation: Silero VAD -> transcription -> chat -> sentence-by-sentence streamed speech, with barge-in
  const speaker = useRef<Speaker | null>(null);
  if (!speaker.current) speaker.current = new Speaker((t) => `${API}/api/v1/voice2/speak?text=${encodeURIComponent(t)}`);
  const splitterRef = useRef(new SentenceSplitter());
  const sendRef = useRef<(text: string, atts: Attachment[]) => Promise<void>>(async () => undefined);
  const timing = useRef<{ speechEnd?: number; transcript?: number; firstDelta?: number }>({});
  const [lat, setLat] = useState<string>("");
  const voice = useVoiceMode({
    speaker: speaker.current,
    onBargeIn: () => abort.current?.abort(),
    onUtterance: (text, t) => { timing.current = { speechEnd: t.speechEnd, transcript: t.transcript }; void sendRef.current(text, []); },
  });
  useEffect(() => {
    speaker.current!.onFirstAudio = (t) => {
      const m = timing.current;
      if (m.speechEnd) {
        const r = { stt_ms: (m.transcript ?? 0) - m.speechEnd, llm_first_token_ms: (m.firstDelta ?? 0) - (m.transcript ?? 0), tts_first_audio_ms: t - (m.firstDelta ?? t), total_ms: t - m.speechEnd };
        (window as unknown as { __voiceLatency?: unknown }).__voiceLatency = r;
        setLat(`${r.total_ms} ms (STT ${r.stt_ms} · reply ${r.llm_first_token_ms} · voice ${r.tts_first_audio_ms})`);
      }
    };
  }, []);
  const { threads, lastRead, approvalLevel, push, patch, append, markRead, setApprovalLevel } = useChat();
  const looks = useBotLook((s) => s.looks);
  const live = useLiveAgents((s) => s.agents);
  const connect = useLiveAgents((s) => s.connect);
  const messages = threads[active.id] ?? [];
  const lastMsg = messages[messages.length - 1];
  const vp = useTranscriptViewport(messages.length, active.id, lastMsg?.text.length);
  const unreadAt = useMemo(() => firstUnreadIndex(messages, lastRead[active.id]), [messages, lastRead, active.id]);
  const unreadRef = useRef(unreadAt); // freeze the divider while the channel is open
  useEffect(() => { unreadRef.current = unreadAt; }, [active.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => connect(WS_URL), [connect]);
  useEffect(() => { fetch(`${API}/api/v1/bots/`).then((r) => r.json()).then((d) => setBots((d.bots ?? []).filter((b: Bot) => b.enabled))).catch(() => undefined); }, []);
  useEffect(() => {
    const load = () => fetch(`${API}/api/v1/hitl/pending`).then((r) => r.json()).then((d) => setPending(d.requests ?? [])).catch(() => undefined);
    load();
    const c = new RpcClient({ url: WS_URL, topics: ["human-intervention-request"], onEvent: load });
    c.start();
    const t = setInterval(load, 5000);
    return () => { c.stop(); clearInterval(t); };
  }, []);
  useEffect(() => {
    fetch(`${API}/api/v1/hitl/levels`).then((r) => r.json()).then((d) => Object.entries(d.levels ?? {}).forEach(([slug, l]) => setApprovalLevel(slug, l as ApprovalLevel))).catch(() => undefined);
  }, [setApprovalLevel]);
  useEffect(() => { markRead(active.id); }, [active.id, messages.length, markRead]);
  useEffect(() => { kick("switch"); setCustomize(false); }, [active.id]);

  const members = useMemo(() => {
    const crew = bots.filter((b) => b.slug !== "jasper" && (!active.crew || b.crew === active.crew));
    return active.kind === "room" ? [{ slug: "jasper", display_name: "Sir Jasper", role_title: "orchestrator", crew: "l1", enabled: true }, ...crew] : bots;
  }, [bots, active]);
  const typing = Object.values(live).filter((a) => ["working", "planning"].includes(a.state)).map((a) => a.slug);

  const send = async (text: string, atts: Attachment[]) => {
    const ch = active.id;
    const history = (threads[ch] ?? []).filter((m) => m.from !== "system").slice(-20).map((m) => ({ role: m.from === "you" ? "user" : "assistant", content: m.text }));
    const mine: ChatMessage = { id: uid(), from: "you", text, ts: Date.now(), status: "sent", attachments: atts };
    push(ch, mine);
    setBusy(true);
    abort.current = new AbortController();
    const payload = { text, history, attachments: atts.map(({ name, mime, text: t }) => ({ name, mime, text: t })) };
    let failed = false;
    try {
      const res = active.kind === "dm"
        ? await fetch(`${API}/api/v1/chat2/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ ...payload, slug: active.id.slice(3) }) })
        : await fetch(`${API}/api/v1/chat2/room`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ ...payload, room: active.label, members: members.map((b) => b.slug) }) });
      patch(ch, mine.id, { status: "delivered" });
      const ids = new Map<string, string>();
      splitterRef.current = new SentenceSplitter();
      timing.current.firstDelta = undefined;
      const talk = voice.enabled && active.kind === "dm";
      let route: { slugs: string[]; source: string; confidence: number } | undefined;
      for await (const ev of readNdjson<Record<string, unknown>>(res)) {
        const slug = String(ev.slug ?? "");
        if (ev.t === "route") route = ev as never;
        else if (ev.t === "speaker") { const id = uid(); ids.set(slug, id); push(ch, { id, from: slug, text: "", ts: Date.now(), streaming: true, meta: route ? { route } : undefined }); patch(ch, mine.id, { status: "read" }); }
        else if (ev.t === "delta" && ids.get(slug)) {
          append(ch, ids.get(slug)!, String(ev.text));
          if (talk) {
            if (!timing.current.firstDelta && timing.current.speechEnd) timing.current.firstDelta = Date.now();
            splitterRef.current.push(String(ev.text)).forEach((x) => { const t = speakable(x); if (t) speaker.current!.speak(t); });
          }
        }
        else if (ev.t === "done" && ids.get(slug)) patch(ch, ids.get(slug)!, { streaming: false });
        else if (ev.t === "error") { failed = true; push(ch, { id: uid(), from: "system", text: `Error: ${ev.message}`, ts: Date.now() }); }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") { failed = true; push(ch, { id: uid(), from: "system", text: "Could not reach the backend.", ts: Date.now() }); }
    } finally {
      const rest = voice.enabled && active.kind === "dm" ? splitterRef.current.flush() : "";
      if (rest) speaker.current!.speak(rest);
      for (const m of useChat.getState().threads[ch] ?? []) if (m.streaming) patch(ch, m.id, { streaming: false });
      setBusy(false);
      kick(failed ? "failure" : "success");
    }
  };
  sendRef.current = send;

  const toggleRec = async (addFiles: (f: File[]) => Promise<void>, setText: (fn: (t: string) => string) => void) => {
    if (recorder) { recorder.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setRecorder(null);
        const file = new File(chunks, `voice-note-${Date.now()}.webm`, { type: "audio/webm" });
        await addFiles([file]);
        try {
          const fd = new FormData(); fd.append("audio", file);
          const r = await fetch(`${API}/api/voice/transcribe`, { method: "POST", body: fd }).then((x) => x.json());
          if (r.text) setText((t) => (t ? t + " " : "") + r.text);
        } catch { /* keep the audio attachment only */ }
      };
      mr.start(); setRecorder(mr);
    } catch { /* microphone denied */ }
  };

  const slugOf = (c: Channel) => c.id.slice(3);
  const nameOf = (c: Channel) => (c.kind === "dm" ? looks[slugOf(c)]?.name : undefined) ?? c.label;
  const last = (c: Channel) => (threads[c.id] ?? []).filter((m) => m.from !== "system").slice(-1)[0];
  const faceFor = (c: Channel): MausState => {
    if (c.id === active.id) {
      if (pending.length && c.kind === "dm") return "alerting";
      if (voice.state === "listening") return "listening";
      if (busy || lastMsg?.streaming) return lastMsg?.streaming && lastMsg.text ? "working" : "thinking";
    }
    return stateFromAgent(live[slugOf(c)]?.state);
  };
  const bot = (c: Channel) => lookFor(looks, c.kind === "dm" ? slugOf(c) : "room:" + c.id);
  const q = query.trim().toLowerCase();
  const dmChannels: Channel[] = [{ id: "dm:jasper", label: "Sir Jasper", kind: "dm" } as Channel, ...bots.filter((b) => b.slug !== "jasper").map((b): Channel => ({ id: `dm:${b.slug}`, label: b.display_name, kind: "dm" }))]
    .filter((c) => !q || nameOf(c).toLowerCase().includes(q));
  const rooms = ROOMS.filter((c) => !q || c.label.toLowerCase().includes(q));

  const row = (c: Channel) => {
    const unread = firstUnreadIndex(threads[c.id] ?? [], lastRead[c.id]) >= 0 && c.id !== active.id;
    const lm = last(c);
    const b = bot(c);
    return (
      <button key={c.id} onClick={() => setActive(c)} data-testid={"chan-" + c.id}
        className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left" style={{ background: active.id === c.id ? "rgba(255,255,255,0.09)" : "transparent" }}>
        {c.kind === "room"
          ? <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-white/10"><Hash size={15} /></span>
          : <MausAvatar color={b.color} bodyId={b.body} size={34} state={faceFor(c)} label={nameOf(c)} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-semibold">{nameOf(c)}</span>
            {lm && <span className="ml-auto shrink-0 text-[11px] opacity-50">{hhmm(lm.ts)}</span>}
          </span>
          <span className="block truncate text-[12px] opacity-55">{lm ? lm.text.replace(/\s+/g, " ") : c.kind === "dm" ? (bots.find((x) => x.slug === slugOf(c))?.role_title ?? "orchestrator") : "Group room"}</span>
        </span>
        {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
      </button>
    );
  };

  const level = active.kind === "dm" ? (approvalLevel[slugOf(active)] ?? "ask") : null;
  const setLevel = (l: ApprovalLevel) => { const slug = slugOf(active); setApprovalLevel(slug, l); void fetch(`${API}/api/v1/hitl/levels/${slug}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: l }) }); };
  const shown = messages.slice(vp.start);
  const ab = bot(active);
  const face = faceFor(active);
  const sectionHead = (label: string, open: boolean, toggle: () => void) => (
    <button onClick={toggle} className="flex w-full items-center gap-1 px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider opacity-50">
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{label}
    </button>
  );

  return (
    <div className="flex h-full min-h-[560px]" data-testid="chat-panel">
      <aside className="flex w-[290px] shrink-0 flex-col border-r border-white/10 bg-black/20">
        <div className="p-3">
          <label className="flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-sm">
            <Search size={14} className="opacity-50" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search chats" className="w-full bg-transparent outline-none placeholder:opacity-50" />
          </label>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-2">
          {sectionHead("Bots", botsOpen, () => setBotsOpen((v) => !v))}
          {botsOpen && dmChannels.map(row)}
          {rooms.length > 0 && sectionHead("Rooms", roomsOpen, () => setRoomsOpen((v) => !v))}
          {roomsOpen && rooms.map(row)}
        </div>
        <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-sm">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-xs">VJ</span>You
        </div>
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="relative flex items-center gap-3 px-5 py-3">
          <MausAvatar color={ab.color} bodyId={ab.body} size={40} state={face} motion={motion.m} motionKey={motion.k} label={nameOf(active)} />
          <span className="text-[17px] font-semibold">{nameOf(active)}</span>
          {active.kind === "dm" && <button onClick={() => setCustomize((v) => !v)} title="Customize" aria-label="Customize" data-testid="customize-btn" className="rounded-full p-1 opacity-50 hover:opacity-100"><Pencil size={13} /></button>}
          <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs opacity-70" data-testid="face-state">{face}</span>
          <div className="ml-auto flex items-center gap-2">
            {voice.error && <span className="text-xs text-red-400">{voice.error}</span>}
            {lat && <span className="text-[11px] opacity-50" title="speech end → first audio">{lat}</span>}
            <button onClick={() => void voice.toggle()} title="Hands-free voice conversation (Silero VAD, barge-in)" data-testid="voice-btn"
              className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-xs" style={{ background: voice.enabled ? "rgba(34,197,94,0.25)" : undefined }}>
              <Mic size={12} />{voice.state === "off" || voice.state === "error" ? "Voice" : voice.state}
            </button>
          </div>
          {customize && <CustomizePopover slug={active.kind === "dm" ? slugOf(active) : active.id} name={active.label} onClose={() => setCustomize(false)} />}
        </header>
        <div ref={vp.scrollRef} onScroll={vp.onScroll} onWheel={vp.onWheel} className="relative flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          {vp.start > 0 && <button onClick={vp.showEarlier} className="mx-auto block text-xs underline opacity-70">Show earlier ({vp.start})</button>}
          {messages.length === 0 && <p className="pt-10 text-center text-sm opacity-60">Hi, I'm {nameOf(active)}. What would you like me to do?</p>}
          {lastMsg && <div className="pb-1 text-center text-xs opacity-45">Today {hhmm(messages[0].ts)}</div>}
          {shown.map((m, i) => (
            <div key={m.id}>
              {vp.start + i === unreadRef.current && <div className="my-2 flex items-center gap-2 text-xs text-blue-400"><span className="h-px flex-1 bg-blue-500/40" />New messages<span className="h-px flex-1 bg-blue-500/40" /></div>}
              <Bubble m={m} onAnswer={(t) => void send(t, [])} />
            </div>
          ))}
          {busy && !(lastMsg?.streaming && lastMsg.text) && (
            <div className="flex items-center gap-2 text-xs opacity-70" data-testid="thinking-chip">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1"><MausAvatar color={ab.color} bodyId={ab.body} size={18} state="thinking" trackPointer={false} />thinking…</span>
            </div>
          )}
          {!busy && typing.length > 0 && <div className="text-xs opacity-60">{typing.join(", ")} working…</div>}
          {pending.map((p) => <ApprovalCard key={p.request_id} p={p} onDone={() => setPending((x) => x.filter((y) => y.request_id !== p.request_id))} />)}
        </div>
        {!vp.following && <button onClick={vp.jumpToBottom} className="absolute bottom-24 right-6 rounded-full bg-blue-600 p-2" title="Jump to latest"><ArrowDown size={16} /></button>}
        <Composer channel={active.id} label={nameOf(active)} members={members} onSend={send} busy={busy} onStop={() => abort.current?.abort()}
          level={level} onLevel={setLevel} rec={!!recorder} onRec={toggleRec} />
      </section>
    </div>
  );
}
