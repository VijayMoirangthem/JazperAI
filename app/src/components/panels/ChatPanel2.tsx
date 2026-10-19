"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ArrowDown, Check, CheckCheck, Copy, Hash, Mic, Paperclip, Send, ShieldCheck, Square, User, X } from "lucide-react";
import { readNdjson } from "@/chat/ndjson";
import { firstUnreadIndex, useChat, type ApprovalLevel, type Attachment, type ChatMessage } from "@/chat/chatStore";
import { useTranscriptViewport } from "@/chat/useTranscriptViewport";
import { RpcClient } from "@/lib/rpcClient";
import { useLiveAgents } from "@/stores/liveAgentsStore";

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
const LEVELS: [ApprovalLevel, string][] = [["ask", "Ask for approval"], ["auto_edits", "Auto-accept edits"], ["approve_for_me", "Approve for me"], ["full", "Full access"]];

/** Splits ``` fenced blocks from prose so code renders monospaced and copyable. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((p, i) => p.startsWith("```")
        ? <pre key={i} className="my-2 overflow-x-auto rounded bg-black/40 p-2 text-xs font-mono">{p.replace(/^```\w*\n?/, "").replace(/```$/, "")}</pre>
        : <span key={i} className="whitespace-pre-wrap">{p}</span>)}
    </>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.from === "you";
  return (
    <div className={`group flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[72%] rounded-2xl px-3 py-2 text-sm" style={{ background: mine ? "#1d4ed8" : "rgba(255,255,255,0.08)" }}>
        {!mine && <div className="text-xs opacity-60 mb-0.5">{m.from}{m.meta?.route ? ` · routed by ${m.meta.route.source}` : ""}</div>}
        {m.attachments?.map((a) => a.dataUrl && a.mime.startsWith("image/")
          ? <img key={a.name} src={a.dataUrl} alt={a.name} className="mb-1 max-h-48 rounded" />
          : a.dataUrl && a.mime.startsWith("audio/")
            ? <audio key={a.name} controls src={a.dataUrl} className="mb-1 h-8" />
            : <div key={a.name} className="mb-1 inline-flex items-center gap-1 rounded bg-black/30 px-2 py-0.5 text-xs"><Paperclip size={11} />{a.name}</div>)}
        <Rich text={m.text || (m.streaming ? "…" : "")} />
        <div className="mt-1 flex items-center justify-end gap-2 text-[10px] opacity-60">
          <button className="opacity-0 group-hover:opacity-100" title="Copy" onClick={() => navigator.clipboard?.writeText(m.text)}><Copy size={11} /></button>
          {new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
    <div role="group" aria-label="Approval request" className="w-full max-w-[600px] rounded-3xl px-4 py-3 ring-1 ring-white/20 bg-white/5 space-y-2">
      <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={16} />Approval needed · Tier {p.tier}<span className="ml-auto text-xs opacity-60">{p.requester}</span></div>
      <div className="text-sm"><span className="font-mono text-xs opacity-70">{p.action}</span><div>{p.summary}</div></div>
      <div className="flex gap-2">
        <button onClick={() => respond(true)} className="rounded-full bg-green-600 px-4 py-1 text-sm">Approve</button>
        <button onClick={() => respond(false)} className="rounded-full bg-white/10 px-4 py-1 text-sm">Deny</button>
      </div>
    </div>
  );
}

function Composer({ channel, members, onSend, busy, onStop }: { channel: string; members: Bot[]; onSend: (text: string, atts: Attachment[]) => void; busy: boolean; onStop: () => void }) {
  const [text, setText] = useState("");
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [rec, setRec] = useState<MediaRecorder | null>(null);
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
  const toggleRec = async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream); const chunks: Blob[] = [];
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setRec(null);
        await addFiles([new File(chunks, `voice-note-${Date.now()}.webm`, { type: "audio/webm" })]);
      };
      mr.start(); setRec(mr);
    } catch { /* microphone denied */ }
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files); };

  return (
    <div className="p-3 border-t" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {atts.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {atts.map((a) => (
            <span key={a.name} className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-xs">
              {a.dataUrl && a.mime.startsWith("image/") && <img src={a.dataUrl} alt="" className="h-6 w-6 rounded object-cover" />}{a.name}
              <button onClick={() => setAtts((x) => x.filter((y) => y !== a))}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {options.length > 0 && (
        <div role="listbox" className="mb-1 rounded border bg-black/60 p-1 text-sm">
          {options.map((b) => <button key={b.slug} role="option" className="block w-full px-2 py-1 text-left hover:bg-white/10"
            onClick={() => setText(text.replace(/@[\w.-]*$/, `@${b.slug} `))}>@{b.slug} <span className="opacity-50">{b.role_title}</span></button>)}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <button onClick={() => fileRef.current?.click()} title="Attach" className="p-2 rounded border"><Paperclip size={16} /></button>
        <button onClick={toggleRec} title={rec ? "Stop recording" : "Voice note"} className="p-2 rounded border" style={{ color: rec ? "#ef4444" : undefined }}><Mic size={16} /></button>
        <textarea value={text} rows={Math.min(6, text.split("\n").length)} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
          placeholder="Message… (@ to mention, /clear, Shift+Enter for newline)"
          className="flex-1 resize-none rounded border bg-transparent px-3 py-2 text-sm" />
        {busy ? <button onClick={onStop} title="Stop" className="p-2 rounded border"><Square size={16} /></button>
          : <button onClick={submit} title="Send" className="p-2 rounded border"><Send size={16} /></button>}
      </div>
    </div>
  );
}

export function ChatPanel2() {
  const [bots, setBots] = useState<Bot[]>([]);
  const [active, setActive] = useState<Channel>({ id: "dm:jasper", label: "Sir Jasper", kind: "dm" });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const abort = useRef<AbortController | null>(null);
  const { threads, lastRead, approvalLevel, push, patch, append, markRead, setApprovalLevel } = useChat();
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
  useEffect(() => { markRead(active.id); }, [active.id, messages.length, markRead]);

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
    try {
      const res = active.kind === "dm"
        ? await fetch(`${API}/api/v1/chat2/stream`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ ...payload, slug: active.id.slice(3) }) })
        : await fetch(`${API}/api/v1/chat2/room`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.current.signal, body: JSON.stringify({ ...payload, room: active.label, members: members.map((b) => b.slug) }) });
      patch(ch, mine.id, { status: "delivered" });
      const ids = new Map<string, string>();
      let route: { slugs: string[]; source: string; confidence: number } | undefined;
      for await (const ev of readNdjson<Record<string, unknown>>(res)) {
        const slug = String(ev.slug ?? "");
        if (ev.t === "route") route = ev as never;
        else if (ev.t === "speaker") { const id = uid(); ids.set(slug, id); push(ch, { id, from: slug, text: "", ts: Date.now(), streaming: true, meta: route ? { route } : undefined }); patch(ch, mine.id, { status: "read" }); }
        else if (ev.t === "delta" && ids.get(slug)) append(ch, ids.get(slug)!, String(ev.text));
        else if (ev.t === "done" && ids.get(slug)) patch(ch, ids.get(slug)!, { streaming: false });
        else if (ev.t === "error") push(ch, { id: uid(), from: "system", text: `Error: ${ev.message}`, ts: Date.now() });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") push(ch, { id: uid(), from: "system", text: "Could not reach the backend.", ts: Date.now() });
    } finally {
      for (const m of useChat.getState().threads[ch] ?? []) if (m.streaming) patch(ch, m.id, { streaming: false });
      setBusy(false);
    }
  };

  const item = (c: Channel) => {
    const unread = firstUnreadIndex(threads[c.id] ?? [], lastRead[c.id]) >= 0 && c.id !== active.id;
    return (
      <button key={c.id} onClick={() => setActive(c)} className="w-full text-left px-3 py-2 flex items-center gap-2 rounded"
        style={{ background: active.id === c.id ? "rgba(255,255,255,0.08)" : "transparent" }}>
        {c.kind === "room" ? <Hash size={14} /> : <User size={14} />}
        <span className="truncate text-sm">{c.label}</span>
        {unread && <span className="ml-auto h-2 w-2 rounded-full bg-blue-500" />}
        {!unread && live[c.id.slice(3)]?.state && <span className="ml-auto text-xs opacity-50">{live[c.id.slice(3)].state}</span>}
      </button>
    );
  };
  const level = approvalLevel[active.id.slice(3)] ?? "ask";
  const shown = messages.slice(vp.start);

  return (
    <div className="flex h-full min-h-[560px]">
      <aside className="w-64 border-r p-2 space-y-1 overflow-y-auto">
        <div className="text-xs uppercase opacity-50 px-3 pt-1">Rooms</div>
        {ROOMS.map(item)}
        <div className="text-xs uppercase opacity-50 px-3 pt-3">Direct</div>
        {item({ id: "dm:jasper", label: "Sir Jasper", kind: "dm" })}
        {bots.filter((b) => b.slug !== "jasper").map((b) => item({ id: `dm:${b.slug}`, label: b.display_name, kind: "dm" }))}
      </aside>
      <section className="relative flex-1 flex flex-col min-w-0">
        <header className="px-4 py-3 border-b flex items-center gap-3">
          <span className="font-semibold">{active.label}</span>
          {active.kind === "dm" && (
            <select value={level} onChange={(e) => setApprovalLevel(active.id.slice(3), e.target.value as ApprovalLevel)} className="ml-auto text-xs rounded border bg-transparent px-2 py-1" title="Approval level for this bot">
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </header>
        <div ref={vp.scrollRef} onScroll={vp.onScroll} onWheel={vp.onWheel} className="relative flex-1 overflow-y-auto p-4 space-y-2">
          {vp.start > 0 && <button onClick={vp.showEarlier} className="mx-auto block text-xs underline opacity-70">Show earlier ({vp.start})</button>}
          {messages.length === 0 && <p className="text-sm opacity-60">No messages yet. Say hello.</p>}
          {shown.map((m, i) => (
            <div key={m.id}>
              {vp.start + i === unreadRef.current && <div className="my-2 flex items-center gap-2 text-xs text-blue-400"><span className="h-px flex-1 bg-blue-500/40" />New messages<span className="h-px flex-1 bg-blue-500/40" /></div>}
              <Bubble m={m} />
            </div>
          ))}
          {typing.length > 0 && <div className="text-xs opacity-60">{typing.join(", ")} working…</div>}
          {pending.map((p) => <ApprovalCard key={p.request_id} p={p} onDone={() => setPending((x) => x.filter((y) => y.request_id !== p.request_id))} />)}
        </div>
        {!vp.following && <button onClick={vp.jumpToBottom} className="absolute right-6 bottom-24 rounded-full bg-blue-600 p-2" title="Jump to latest"><ArrowDown size={16} /></button>}
        <Composer channel={active.id} members={members} onSend={send} busy={busy} onStop={() => abort.current?.abort()} />
      </section>
    </div>
  );
}
