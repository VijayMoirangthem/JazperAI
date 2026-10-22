"use client";

// Chat UI modelled on Project_References/OpenMausBot: bot list with animated mascots, pill composer,
// per-bot customisation (colour + body), mascot faces that follow what the bot is doing.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowDown, Check, CheckCheck, Copy, Hand, Loader2, MoreHorizontal, Mic, Paperclip, Pencil, RefreshCw, SendHorizontal, ShieldCheck, Square, ThumbsDown, ThumbsUp, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { readNdjson } from "@/chat/ndjson";
import { firstUnreadIndex, useChat, type ApprovalLevel, type Attachment, type ChatMessage } from "@/chat/chatStore";
import { useTranscriptViewport } from "@/chat/useTranscriptViewport";
import { RpcClient } from "@/lib/rpcClient";
import { SentenceSplitter, speakable } from "@/voice/audio";
import { Speaker } from "@/voice/speaker";
import { useVoiceMode } from "@/voice/useVoiceMode";
import { useLiveAgents } from "@/stores/liveAgentsStore";
import { useChatIntent } from "@/stores/chatIntentStore";
import { useDrafts } from "@/chat/draftStore";
import { MausAvatar, lookFor, stateFromAgent, useBotLook, voiceOf, type MausMotion, type MausState } from "@/mascot/MausAvatar";
import { speakAs, stopSpeaking, useTts } from "@/voice/botVoice";
import { OrgSidebar, ScoreBadge, type OrgGroup } from "@/components/chat/OrgSidebar";
import { BotSettings } from "@/components/chat/BotSettings";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { ConfirmActionCard, FileCard, CredentialCard, OAuthCard, SuggestionCard } from "@/components/chat/ChatCards";
import { CommsView, useCommsThreads } from "@/components/chat/CommsView";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";
const uid = () => Math.random().toString(36).slice(2, 10);

interface Bot { slug: string; display_name: string; role_title: string; crew: string; enabled: boolean }
interface Channel { id: string; label: string; kind: "dm" | "room" | "comms"; crew?: string }
interface Pending { request_id: string; tier: number; action: string; summary: string; requester: string }

const ROOMS: Channel[] = [
  { id: "room:create_origins", label: "Create Origins HQ", kind: "room" },
  { id: "room:baeit", label: "Baeit Engineering", kind: "room", crew: "baeit" },
  { id: "room:boardmint", label: "Boardmint Compliance", kind: "room", crew: "boardmint" },
  { id: "room:jazper_team", label: "Jazper Team", kind: "room", crew: "jazper_team" },
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
        : <span key={i} className="whitespace-pre-wrap">{p.split("**").map((t, j) => (j % 2 === 1 ? <strong key={j}>{t}</strong> : t))}</span>)}
    </>
  );
}

const hhmm = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function Bubble({ m, onAnswer, onRate, onCard, onDelete, onEdit, onSpeak, onRegenerate }: { m: ChatMessage; onAnswer?: (t: string) => void; onRate?: (up: boolean) => void; onCard?: (t: string) => void; onDelete?: () => void; onEdit?: (t: string) => void; onSpeak?: () => void; onRegenerate?: () => void }) {
  const mine = m.from === "you";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  if (m.phase) return <div className="my-1 flex items-center gap-2 text-xs opacity-60" data-testid="phase"><span className="h-px flex-1 bg-white/15" />{m.text}<span className="h-px flex-1 bg-white/15" /></div>;
  if (m.ui) return <div className="flex justify-start">{m.ui.kind === "suggestions" ? <SuggestionCard items={m.ui.items ?? []} onDone={(t) => onCard?.(t)} /> : m.ui.kind === "file" ? <FileCard req={m.ui} fresh={Date.now() - m.ts < 15000} /> : m.ui.kind === "confirm" ? <ConfirmActionCard req={m.ui} messageId={m.id} /> : m.ui.kind === "credentials" ? <CredentialCard req={m.ui} onDone={(t) => onCard?.(t)} /> : <OAuthCard req={m.ui} onDone={(t) => onCard?.(t)} />}</div>;
  const system = m.from === "system";
  const [rated, setRated] = useState<boolean | null>(null);
  if (m.tool) {
    const t = m.tool;
    return (
      <div className="flex justify-start" data-testid="tool-chip" title={t.result}>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1 font-mono text-xs opacity-90">
          {t.status === "running" ? <Loader2 size={12} className="animate-spin" /> : t.status === "ok" ? <Check size={12} className="text-green-400" /> : <X size={12} className="text-red-400" />}
          {t.label}
          {t.untrusted && <span title={`This request handled untrusted content from: ${t.untrusted}. Changes now need your explicit approval.`} data-testid="untrusted-badge" className="ml-1 rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-300">untrusted</span>}
        </span>
      </div>
    );
  }
  if (!m.text && !m.streaming && !m.attachments?.length) return null;
  return (
    <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[78%] rounded-[20px] px-4 py-2.5 text-[15px] leading-snug"
        style={{ background: mine ? "#5c5c5c" : system ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.08)" }}>
        {!mine && !system && m.meta?.route && <div className="mb-0.5 text-[11px] opacity-50">{m.from} · routed by {m.meta.route.source}</div>}
        {m.attachments?.map((a) => (a.dataUrl || a.url) && a.mime.startsWith("image/")
          ? <img key={a.name} src={a.dataUrl ?? a.url} alt={a.name} className="mb-1 max-h-48 rounded-lg" />
          : a.dataUrl && a.mime.startsWith("audio/")
            ? <audio key={a.name} controls src={a.dataUrl} className="mb-1 h-8" />
            : <div key={a.name} className="mb-1 inline-flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-xs"><Paperclip size={11} />{a.name}</div>)}
        {editing ? (
          <div className="space-y-1.5">
            <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.min(8, draft.split("\n").length + 1)} aria-label="Edit message" className="w-full min-w-[280px] resize-none rounded-lg bg-black/30 p-2 text-sm outline-none" />
            <div className="flex justify-end gap-2 text-xs"><button onClick={() => { setEditing(false); setDraft(m.text); }} className="rounded-full bg-white/10 px-3 py-1">Cancel</button><button onClick={() => { setEditing(false); if (draft.trim()) onEdit?.(draft.trim()); }} className="rounded-full bg-blue-600 px-3 py-1">Save &amp; resend</button></div>
          </div>
        ) : <Rich text={m.text || (m.streaming ? "…" : "")} onAnswer={m.streaming ? undefined : onAnswer} />}
        <div className="mt-0.5 flex items-center justify-end gap-2 text-[10px] opacity-0 transition-opacity group-hover:opacity-60">
          {!mine && !system && !m.streaming && onRate && (
            <>
              <button title="Good answer" aria-label="Good answer" disabled={rated !== null} onClick={() => { setRated(true); onRate(true); }}><ThumbsUp size={11} className={rated === true ? "text-green-400" : ""} /></button>
              <button title="Bad answer" aria-label="Bad answer" disabled={rated !== null} onClick={() => { setRated(false); onRate(false); }}><ThumbsDown size={11} className={rated === false ? "text-red-400" : ""} /></button>
            </>
          )}
          {!mine && !system && !m.streaming && onSpeak && <button title="Read aloud" aria-label="Read aloud" data-testid="speak-btn" onClick={onSpeak}><Volume2 size={11} /></button>}
          {!mine && !system && !m.streaming && onRegenerate && <button title="Regenerate" aria-label="Regenerate" onClick={onRegenerate}><RefreshCw size={11} /></button>}
          {mine && onEdit && <button title="Edit and resend" aria-label="Edit message" data-testid="edit-btn" onClick={() => { setDraft(m.text); setEditing(true); }}><Pencil size={11} /></button>}
          {onDelete && <button title="Delete message" aria-label="Delete message" data-testid="delete-btn" onClick={onDelete}><Trash2 size={11} /></button>}
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
      {p.summary.includes("UNTRUSTED CONTENT") && <div data-testid="untrusted-warning" className="rounded-xl bg-amber-500/15 px-3 py-2 text-xs text-amber-200">This action was requested after reading external content (email, file or web). Check that it is what <b>you</b> asked for before approving.</div>}
      <div className="text-sm"><span className="font-mono text-xs opacity-70">{p.action}</span><div>{p.summary}</div></div>
      <div className="flex gap-2">
        <button onClick={() => respond(true)} className="rounded-full bg-green-600 px-4 py-1 text-sm">Approve</button>
        <button onClick={() => respond(false)} className="rounded-full bg-white/10 px-4 py-1 text-sm">Deny</button>
      </div>
    </div>
  );
}

function Composer({ channel, label, members, onSend, onMeeting, busy, onStop, level, onLevel, rec, onRec }: {
  onMeeting?: (topic: string) => void;
  channel: string; label: string; members: Bot[]; onSend: (text: string, atts: Attachment[]) => void; busy: boolean; onStop: () => void;
  level: ApprovalLevel | null; onLevel: (l: ApprovalLevel) => void; rec: boolean; onRec: (addFiles: (f: File[]) => Promise<void>, setText: (fn: (t: string) => string) => void) => void;
}) {
  const text = useDrafts((s) => s.text[channel] ?? ""); // draft survives switching chats/tabs
  const setText = (v: string | ((t: string) => string)) => useDrafts.getState().set(channel, typeof v === "function" ? v(useDrafts.getState().text[channel] ?? "") : v);
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
      void fetch(`${API}/api/v1/files/`, { method: "POST", body: (() => { const fd = new FormData(); fd.append("file", f); return fd; })() })
        .then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setAtts((x) => x.map((y) => (y.name === a.name && y.size === a.size ? { ...y, key: d.key, url: `${API}${d.url}` } : y))); }).catch(() => undefined);
    }
    setAtts((x) => [...x, ...out]);
  };
  const submit = () => {
    if (!text.trim() && !atts.length) return;
    if (text.trim() === "/clear") { useChat.getState().clear(channel); setText(""); return; }
    onSend(text.trim(), atts.map((a) => (a.url && a.dataUrl ? { ...a, dataUrl: undefined } : a))); setText(""); setAtts([]);
  };
  const [dragOver, setDragOver] = useState(false);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) { e.preventDefault(); void addFiles(files.map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `pasted-${Date.now()}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type })))); }
  };

  return (
    <div className="relative px-5 pb-4 pt-2" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop} data-testid="composer">
      {dragOver && <div className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-3xl border-2 border-dashed border-blue-400/70 bg-blue-500/10 text-sm">Drop files to attach</div>}
      {atts.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="attachments">
          {atts.map((a) => (
            <div key={a.name} className="group/att relative flex items-center gap-2 rounded-2xl bg-white/10 p-1.5 pr-3 text-xs">
              {a.dataUrl && a.mime.startsWith("image/") ? <img src={a.dataUrl} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10"><Paperclip size={16} /></span>}
              <span className="max-w-[160px]"><span className="block truncate font-medium">{a.name}</span><span className="opacity-60">{a.size > 1024 ? `${Math.round(a.size / 1024)} KB` : `${a.size} B`}</span></span>
              <button aria-label={`Remove ${a.name}`} onClick={() => setAtts((x) => x.filter((y) => y !== a))} className="absolute -right-1.5 -top-1.5 rounded-full bg-black/80 p-0.5"><X size={11} /></button>
            </div>
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
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} onPaste={onPaste}
          placeholder={`Message ${label}`} aria-label="Message"
          className="flex-1 resize-none bg-transparent py-1 text-[15px] outline-none placeholder:opacity-50" />
        {onMeeting && <button onClick={() => { if (text.trim()) { onMeeting(text.trim()); setText(""); } }} title="Hold a meeting: the bots of this group discuss your message and the lead concludes" data-testid="meeting-btn" disabled={!text.trim()} className="rounded-full border border-white/15 px-2.5 py-1 text-xs opacity-80 hover:opacity-100 disabled:opacity-30">Meeting</button>}
        <button onClick={() => onRec(addFiles, setText)} title={rec ? "Stop recording" : "Voice note"} className="rounded-full p-1.5 opacity-70 hover:opacity-100" style={{ color: rec ? "#ef4444" : undefined }}><Mic size={17} /></button>
        {busy
          ? <button onClick={onStop} title="Stop" className="rounded-full bg-white/20 p-1.5"><Square size={15} /></button>
          : <button onClick={submit} title="Send" className="rounded-full bg-white/20 p-1.5 hover:bg-white/30"><SendHorizontal size={15} /></button>}
      </div>
    </div>
  );
}

export function ChatPanel2() {
  const [groups, setGroups] = useState<OrgGroup[]>([]);
  const [active, setActive] = useState<Channel>({ id: "dm:jasper", label: "Sir Jasper", kind: "dm" });
  const intent = useChatIntent((st) => st.intent); // "open this chat" requests from other panels (Office 2)
  useEffect(() => {
    if (!intent) return;
    setActive({ id: intent.id, label: intent.label, kind: intent.kind, crew: intent.crew });
    useChatIntent.getState().consume();
  }, [intent]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [query, setQuery] = useState("");
  const [customize, setCustomize] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const tts = useTts();
  const commsThreads = useCommsThreads();
  const loadTree = () => fetch(`${API}/api/v1/bots/tree`).then((r) => r.json()).then((d) => setGroups(d.groups ?? [])).catch(() => undefined);
  const [motion, setMotion] = useState<{ m: MausMotion; k: number }>({ m: "arrive", k: 0 });
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { // Esc stops whatever Jasper is doing right now
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && abort.current && busy) abort.current.abort(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);
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
  useEffect(() => { void loadTree(); const t = setInterval(loadTree, 30000); return () => clearInterval(t); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bots: Bot[] = useMemo(() => groups.flatMap((g) => g.bots).filter((b) => b.enabled).map((b) => ({ slug: b.slug, display_name: b.display_name, role_title: b.role_title, crew: b.crew, enabled: true })), [groups]);
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

  const send = async (text: string, atts: Attachment[], mode?: "meeting") => {
    const ch = active.id;
    const history = (threads[ch] ?? []).filter((m) => m.from !== "system" && !m.tool && m.text).slice(-20).map((m) => ({ role: m.from === "you" ? "user" : "assistant", content: m.text }));
    const mine: ChatMessage = { id: uid(), from: "you", text, ts: Date.now(), status: "sent", attachments: atts };
    push(ch, mine);
    setBusy(true);
    abort.current = new AbortController();
    const payload = { text, history, attachments: atts.map(({ name, mime, text: t }) => ({ name, mime, text: t })) };
    let failed = false;
    try {
      const res = mode === "meeting"
        ? await fetch(`${API}/api/v1/chat2/meeting`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ group: active.id.slice(5), topic: text, rounds: 2 }) })
        : active.kind === "dm"
        ? await fetch(`${API}/api/v1/chat2/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ ...payload, slug: active.id.slice(3) }) })
        : await fetch(`${API}/api/v1/chat2/room`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ ...payload, room: active.label, members: members.map((b) => b.slug) }) });
      patch(ch, mine.id, { status: "delivered" });
      const ids = new Map<string, string>();
      const startMsg = (slug: string) => { const id = uid(); ids.set(slug, id); push(ch, { id, from: slug, text: "", ts: Date.now(), streaming: true, meta: route ? { route } : undefined }); return id; };
      splitterRef.current = new SentenceSplitter();
      timing.current.firstDelta = undefined;
      const talk = voice.enabled && active.kind === "dm";
      let route: { slugs: string[]; source: string; confidence: number } | undefined;
      for await (const ev of readNdjson<Record<string, unknown>>(res)) {
        const slug = String(ev.slug ?? "");
        if (ev.t === "route") route = ev as never;
        else if (ev.t === "speaker") { startMsg(slug); patch(ch, mine.id, { status: "read" }); }
        else if (ev.t === "phase") push(ch, { id: uid(), from: "system", text: String(ev.text), ts: Date.now(), phase: true });
        else if (ev.t === "ui") { push(ch, { id: uid(), from: slug, text: "", ts: Date.now(), ui: { ...(ev as object), kind: ev.kind as "credentials" | "oauth" | "suggestions" | "confirm" | "file", connector: String(ev.connector ?? "") } as never }); ids.delete(slug); } // keep EVERY field (capability, reason, scope, label...): dropping them made the Drive card finish instantly
        else if (ev.t === "tool") {
          const label = String(ev.label ?? ev.name); const status = ev.status as "running" | "ok" | "error";
          const open = [...(useChat.getState().threads[ch] ?? [])].reverse().find((x) => x.tool && x.tool.status === "running" && x.tool.label === label);
          if (open && status !== "running") patch(ch, open.id, { tool: { name: String(ev.name), label, status, result: String(ev.result ?? ""), untrusted: ev.untrusted ? String(ev.untrusted) : undefined } });
          else push(ch, { id: uid(), from: slug, text: "", ts: Date.now(), tool: { name: String(ev.name), label, status } });
          ids.delete(slug);
        }
        else if (ev.t === "delta") {
          if (!ids.get(slug)) startMsg(slug);
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
      else push(ch, { id: uid(), from: "system", text: "Stopped.", ts: Date.now() });
    } finally {
      const rest = voice.enabled && active.kind === "dm" ? splitterRef.current.flush() : "";
      if (rest) speaker.current!.speak(rest);
      for (const m of useChat.getState().threads[ch] ?? []) if (m.streaming) patch(ch, m.id, { streaming: false });
      setBusy(false);
      kick(failed ? "failure" : "success");
      const done = [...(useChat.getState().threads[ch] ?? [])].reverse().find((x) => x.from !== "you" && x.from !== "system" && !x.tool && !x.ui && x.text);
      if (!failed && done && !voice.enabled && looks[done.from]?.autoSpeak) speakAs(done.from, voiceOf(looks, done.from), done.text);
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
  const chanLast = (id: string) => (threads[id] ?? []).filter((m) => m.from !== "system" && !m.tool && m.text).slice(-1)[0];
  const faceFor = (id: string): MausState => {
    if (id === active.id) {
      if (pending.length && active.kind === "dm") return "alerting";
      if (voice.state === "listening") return "listening";
      if (busy || lastMsg?.streaming) return lastMsg?.streaming && lastMsg.text ? "working" : "thinking";
    }
    return stateFromAgent(live[id.slice(3)]?.state);
  };
  const activeBot = groups.flatMap((g) => g.bots).find((b) => b.slug === slugOf(active));
  const rate = (slug: string) => (up: boolean) => { void fetch(`${API}/api/v1/bots/${slug}/rate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ up }) }).then(loadTree); };
  const roomRows = ROOMS.map((r) => ({ id: r.id, label: r.label }));

  const level = active.kind === "dm" ? (approvalLevel[slugOf(active)] ?? "ask") : null;
  const setLevel = (l: ApprovalLevel) => { const slug = slugOf(active); setApprovalLevel(slug, l); void fetch(`${API}/api/v1/hitl/levels/${slug}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level: l }) }); };
  const shown = messages.slice(vp.start);
  const ab = lookFor(looks, active.kind === "dm" ? slugOf(active) : "room:" + active.id);
  const face = faceFor(active.id);
  return (
    <div className="flex h-full min-h-[560px]" data-testid="chat-panel">
      <OrgSidebar comms={commsThreads} groups={groups} rooms={roomRows} activeId={active.id} query={query} onQuery={setQuery} onChanged={loadTree}
        onSelect={(id, label, kind, crew) => setActive({ id, label, kind, crew })}
        faceFor={faceFor} lastOf={chanLast} unreadOf={(id) => id !== active.id && firstUnreadIndex(threads[id] ?? [], lastRead[id]) >= 0}
        nameOf={(slug, fb) => looks[slug]?.name ?? fb} />

      {active.kind === "comms" ? <CommsView thread={active.id.slice(6)} /> : (
      <section className="relative flex min-w-0 flex-1 flex-col">
        <header className="relative flex items-center gap-3 px-5 py-3">
          <MausAvatar color={ab.color} bodyId={ab.body} size={40} state={face} motion={motion.m} motionKey={motion.k} label={nameOf(active)} />
          <span className="text-[17px] font-semibold">{nameOf(active)}</span>
          {active.kind === "dm" && <button onClick={() => setCustomize((v) => !v)} title="Bot settings" aria-label="Bot settings" data-testid="customize-btn" className="rounded-full p-1 opacity-50 hover:opacity-100"><Pencil size={13} /></button>}
          {activeBot && <ScoreBadge bot={activeBot} />}
          {activeBot && active.kind === "dm" && <ModelPicker bot={activeBot} onChanged={loadTree} />}
          <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs opacity-70" data-testid="face-state">{face}</span>
          {activeBot && <span className="hidden truncate text-xs opacity-50 xl:block">{activeBot.position}</span>}
          <div className="ml-auto flex items-center gap-2">
            {tts.speaking && <button onClick={stopSpeaking} title="Stop speaking" data-testid="stop-speaking" className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs"><VolumeX size={12} />Stop</button>}
            <div className="relative">
              <button onClick={() => setMenuOpen((v) => !v)} title="Chat options" aria-label="Chat options" data-testid="chat-menu-btn" className="rounded-full p-1.5 opacity-70 hover:opacity-100"><MoreHorizontal size={16} /></button>
              {menuOpen && (
                <div className="absolute right-0 top-9 z-30 w-52 rounded-xl border border-white/10 bg-[#1b1b1b] p-1 text-sm shadow-xl">
                  <button data-testid="clear-chat" onClick={() => { setMenuOpen(false); if (window.confirm(`Delete all messages in this chat with ${nameOf(active)}?`)) useChat.getState().clear(active.id); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/10"><Trash2 size={13} />Delete chat history</button>
                </div>
              )}
            </div>
            {voice.error && <span className="text-xs text-red-400">{voice.error}</span>}
            {lat && <span className="text-[11px] opacity-50" title="speech end → first audio">{lat}</span>}
            <button onClick={() => void voice.toggle()} title="Hands-free voice conversation (Silero VAD, barge-in)" data-testid="voice-btn"
              className="flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-xs" style={{ background: voice.enabled ? "rgba(34,197,94,0.25)" : undefined }}>
              <Mic size={12} />{voice.state === "off" || voice.state === "error" ? "Voice" : voice.state}
            </button>
          </div>
        </header>
        <div ref={vp.scrollRef} onScroll={vp.onScroll} onWheel={vp.onWheel} className="relative flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
          {vp.start > 0 && <button onClick={vp.showEarlier} className="mx-auto block text-xs underline opacity-70">Show earlier ({vp.start})</button>}
          {messages.length === 0 && <p className="pt-10 text-center text-sm opacity-60">Hi, I'm {nameOf(active)}. What would you like me to do?</p>}
          {lastMsg && <div className="pb-1 text-center text-xs opacity-45">Today {hhmm(messages[0].ts)}</div>}
          {shown.map((m, i) => (
            <div key={m.id}>
              {vp.start + i === unreadRef.current && <div className="my-2 flex items-center gap-2 text-xs text-blue-400"><span className="h-px flex-1 bg-blue-500/40" />New messages<span className="h-px flex-1 bg-blue-500/40" /></div>}
              <Bubble m={m} onDelete={() => useChat.getState().remove(active.id, m.id)} onEdit={m.from === "you" ? (t) => { useChat.getState().truncateFrom(active.id, m.id); void send(t, m.attachments ?? []); } : undefined}
                onSpeak={m.from !== "you" && m.from !== "system" ? () => speakAs(m.from, voiceOf(looks, m.from), m.text) : undefined}
                onRegenerate={m.id === lastMsg?.id && m.from !== "you" && m.from !== "system" && !busy ? () => { const prev = [...messages].reverse().find((x) => x.from === "you"); if (prev) { useChat.getState().truncateFrom(active.id, prev.id); void send(prev.text, prev.attachments ?? []); } } : undefined}
                onCard={(t) => void send(t, [])} onAnswer={(t) => void send(t, [])} onRate={m.from !== "you" && m.from !== "system" ? rate(m.from) : undefined} />
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
        <Composer onMeeting={active.kind === "room" ? (t) => void send(t, [], "meeting") : undefined} channel={active.id} label={nameOf(active)} members={members} onSend={send} busy={busy} onStop={() => abort.current?.abort()}
          level={level} onLevel={setLevel} rec={!!recorder} onRec={toggleRec} />
      </section>
      )}
      {customize && active.kind === "dm" && <BotSettings slug={slugOf(active)} groups={groups} onClose={() => setCustomize(false)} onChanged={loadTree} />}
    </div>
  );
}
