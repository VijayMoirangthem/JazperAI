"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { conversationTitle, type ConversationMessage } from "../core/conversationChat";
import { loadOfficePersonSession, officePersonAuthHeaders } from "../core/auth";
import { safeStorage } from "../core/storage";
import { parseAppearance } from "../core/appearance";
import { loadOfficeViewSettings } from "../core/settings";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const keyFor = (members: readonly string[]) => `office3.conversation.${[...members].sort().join(".")}`;
const draftKeyFor = (members: readonly string[]) => `${keyFor(members)}.draft`;
type Member = { slug: string; name: string; kind: "human" | "agent" | "bot" };
type StoredMessage = ConversationMessage & { id?: number; clientId?: string; delivery?: "sending" | "local" };
const speakMessage = (text: string) => {
  if (!loadOfficeViewSettings().sound || !("speechSynthesis" in window)) return;
  let requested = "", locale = "en-US";
  try { const appearance = parseAppearance(JSON.parse(safeStorage.get("office3.appearance") ?? "{}")); requested = appearance.voice.replace("Neural", "").toLowerCase(); locale = appearance.voice.startsWith("en-GB") ? "en-GB" : "en-US"; } catch { /* use browser default voice */ }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 1000));
  utterance.voice = window.speechSynthesis.getVoices().find(voice => requested && voice.name.toLowerCase().includes(requested)) ?? window.speechSynthesis.getVoices().find(voice => voice.lang.startsWith(locale)) ?? null;
  utterance.lang = locale;
  window.speechSynthesis.speak(utterance);
};

export function ConversationDrawer({ members, privateRoom = false, onClose }: { members: readonly Member[]; privateRoom?: boolean; onClose(): void }) {
  const participantIds = useMemo(() => members.map(member => member.slug).sort(), [members]);
  const storageKey = useMemo(() => keyFor(participantIds), [participantIds]);
  const draftKey = useMemo(() => draftKeyFor(participantIds), [participantIds]);
  const conversationId = participantIds.join(".");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [text, setText] = useState("");
  const [synced, setSynced] = useState(false);
  const [typists, setTypists] = useState<string[]>([]);
  const [agentReplying, setAgentReplying] = useState(false);
  const typingTimer = useRef<number | null>(null);
  const agentReplyAbort = useRef<AbortController | null>(null);
  const sender = loadOfficePersonSession()?.personId ?? members.find(member => member.kind === "human")?.slug ?? "founder";
  const directAgent = members.length === 2 && members.filter(member => member.kind === "agent").length === 1 && members.filter(member => member.kind === "human").length === 1 ? members.find(member => member.kind === "agent") : undefined;

  useEffect(() => {
    let stopped = false;
    const fallback = () => {
      try { if (!stopped) setMessages(JSON.parse(safeStorage.get(storageKey) ?? "[]")); }
      catch { if (!stopped) setMessages([]); }
    };
    const load = () => fetch(`${API}/api/v1/office/conversations?participants=${encodeURIComponent(participantIds.join(","))}`, { headers: officePersonAuthHeaders() })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(value => {
        if (stopped) return;
        const remote = (value.messages ?? []).map((message: { id: number; sender: string; text: string; at: number }) => ({ id: Number(message.id), from: message.sender, text: message.text, at: Number(message.at) }));
        setMessages(current => [...remote, ...current.filter(message => !message.id)].slice(-100));
        setSynced(true);
      })
      .catch(fallback);
    const loadTyping = () => fetch(`${API}/api/v1/office/conversations/typing?participants=${encodeURIComponent(participantIds.join(","))}`, { headers: officePersonAuthHeaders() })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(value => { if (!stopped) setTypists((value.typists ?? []).filter((id: string) => id !== sender)); })
      .catch(() => { if (!stopped) setTypists([]); });
    load();
    loadTyping();
    const timer = window.setInterval(() => { load(); loadTyping(); }, 3000);
    return () => { stopped = true; agentReplyAbort.current?.abort(); agentReplyAbort.current = null; window.clearInterval(timer); if (typingTimer.current) window.clearTimeout(typingTimer.current); void fetch(`${API}/api/v1/office/conversations/typing`, { method: "PUT", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ participants: participantIds, sender, active: false }) }); };
  }, [participantIds, sender, storageKey]);

  useEffect(() => { setText(safeStorage.get(draftKey) ?? ""); }, [draftKey]);

  useEffect(() => {
    const removeDeletedPersonMessages = (event: Event) => {
      const personId = (event as CustomEvent<{ personId?: unknown }>).detail?.personId;
      if (personId !== sender) return;
      setMessages(current => {
        const next = current.filter(message => message.from !== sender);
        safeStorage.set(storageKey, JSON.stringify(next));
        return next;
      });
    };
    window.addEventListener("office3:conversation-data-deleted", removeDeletedPersonMessages);
    return () => window.removeEventListener("office3:conversation-data-deleted", removeDeletedPersonMessages);
  }, [sender, storageKey]);

  const persist = (local: StoredMessage) => {
    const saveLocal = () => setMessages(current => {
      const next = current.map(message => message.clientId === local.clientId ? { ...message, delivery: "local" as const } : message).slice(-100);
      safeStorage.set(storageKey, JSON.stringify(next));
      return next;
    });
    return fetch(`${API}/api/v1/office/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() },
      body: JSON.stringify({ participants: participantIds, sender: local.from, text: local.text, role: "founder", private_room: privateRoom }),
    }).then(response => response.ok ? response.json() : Promise.reject())
      .then(value => {
        const message = value.message;
        setMessages(current => {
          const next = current.map(item => item.clientId === local.clientId ? { id: Number(message.id), from: message.sender, text: message.text, at: Number(message.at) } : item);
          safeStorage.set(storageKey, JSON.stringify(next));
          return next;
        });
        setSynced(true);
        return true;
      }).catch(() => { setSynced(false); saveLocal(); return false; });
  };
  const requestAgentReply = async (message: string, agent: Member) => {
    agentReplyAbort.current?.abort();
    const controller = new AbortController();
    agentReplyAbort.current = controller;
    setAgentReplying(true);
    try {
      const response = await fetch(`${API}/api/direct/agent/${encodeURIComponent(agent.slug)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }), signal: controller.signal,
      });
      if (!response.ok || !response.body) throw Error("agent reply unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const streamClientId = `agent-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const streamAt = Date.now();
      let pending = "", reply = "", complete = false, visibleReply = false, replyFrame: number | null = null;
      const showReply = () => {
        replyFrame = null;
        if (controller.signal.aborted) return;
        const partial: StoredMessage = { from: agent.slug, text: reply, at: streamAt, clientId: streamClientId, delivery: "sending" };
        setMessages(current => visibleReply ? current.map(item => item.clientId === streamClientId ? partial : item) : [...current, partial].slice(-100));
        visibleReply = true;
      };
      const scheduleReply = () => { if (replyFrame === null) replyFrame = window.requestAnimationFrame(showReply); };
      const consume = (chunk: string) => {
        for (const frame of chunk.split("\n\n")) {
          const value = frame.startsWith("data: ") ? frame.slice(6) : "";
          if (!value || value.startsWith("[TOOL]") || value.startsWith("[TOOL_RESULT]") || value.startsWith("[APPROVAL]")) continue;
          if (value === "[DONE]") { complete = true; continue; }
          if (value.startsWith("[ERROR]")) throw Error("agent reply failed");
          reply += value.replace(/\\\\n/g, "\n");
          scheduleReply();
        }
      };
      while (!complete) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value ?? new Uint8Array(), { stream: !done });
        const boundary = pending.lastIndexOf("\n\n");
        if (boundary >= 0) { consume(pending.slice(0, boundary)); pending = pending.slice(boundary + 2); }
        if (done) { if (pending) consume(pending); break; }
      }
      if (replyFrame !== null) { window.cancelAnimationFrame(replyFrame); showReply(); }
      const answer = reply.trim();
      if (!answer) throw Error("agent returned no reply");
      const local: StoredMessage = { from: agent.slug, text: answer, at: streamAt, clientId: streamClientId, delivery: "sending" };
      setMessages(current => visibleReply ? current.map(item => item.clientId === streamClientId ? local : item) : [...current, local].slice(-100));
      void persist(local);
    } catch {
      if (controller.signal.aborted) return;
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `${agent.name} could not reply right now.`, priority: "error" } }));
    } finally { if (agentReplyAbort.current === controller) { agentReplyAbort.current = null; setAgentReplying(false); } }
  };
  const send = () => {
    const value = text.trim();
    if (!value) return;
    const local: StoredMessage = { from: sender, text: value, at: Date.now(), clientId: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`, delivery: "sending" };
    setMessages(current => [...current, local].slice(-100));
    void persist(local).then(saved => { if (saved && directAgent) void requestAgentReply(value, directAgent); });
    setText("");
    safeStorage.remove(draftKey);
    void fetch(`${API}/api/v1/office/conversations/typing`, { method: "PUT", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ participants: participantIds, sender, active: false }) });
  };
  const announceTyping = (value: string) => {
    setText(value);
    if (value) safeStorage.set(draftKey, value); else safeStorage.remove(draftKey);
    if (!value.trim()) return;
    void fetch(`${API}/api/v1/office/conversations/typing`, { method: "PUT", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ participants: participantIds, sender, active: true }) });
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(() => { void fetch(`${API}/api/v1/office/conversations/typing`, { method: "PUT", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ participants: participantIds, sender, active: false }) }); }, 1400);
  };
  const retry = (message: StoredMessage) => {
    const clientId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const local = { ...message, clientId, delivery: "sending" as const };
    setMessages(current => current.map(item => item === message ? local : item));
    void persist(local).then(saved => { if (saved && directAgent) void requestAgentReply(local.text, directAgent); });
  };
  const clearDraft = () => {
    setText("");
    safeStorage.remove(draftKey);
    if (typingTimer.current) window.clearTimeout(typingTimer.current);
    void fetch(`${API}/api/v1/office/conversations/typing`, { method: "PUT", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ participants: participantIds, sender, active: false }) });
  };
  const remove = (id: number) => {
    fetch(`${API}/api/v1/office/conversations/${encodeURIComponent(conversationId)}/${id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ role: "founder" }),
    }).then(response => {
      if (!response.ok) throw Error("delete failed");
      setMessages(current => current.filter(message => message.id !== id));
    }).catch(() => window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Message could not be removed.", priority: "error" } })));
  };
  const report = (id: number) => {
    const reason = window.prompt("Why should this message be reviewed?", "Untrusted or inappropriate content");
    if (!reason?.trim()) return;
    fetch(`${API}/api/v1/office/conversations/${encodeURIComponent(conversationId)}/${id}/report`, {
      method: "POST", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ reporter: sender, reason: reason.trim() }),
    }).then(response => {
      if (!response.ok) throw Error("report failed");
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Message reported for review.", priority: "success" } }));
    }).catch(() => window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Message could not be reported.", priority: "error" } })));
  };

  return <aside className="absolute bottom-14 right-3 z-40 flex h-80 w-80 flex-col rounded-xl bg-slate-950/95 p-3 text-white shadow-2xl ring-1 ring-white/15">
    <button className="float-right self-end text-xs opacity-70" onClick={onClose}>Close</button>
    <h2 className="mb-1 text-sm font-semibold">{conversationTitle(members.map(member => member.name))}</h2>
    {privateRoom && <p className="mb-1 text-[10px] text-amber-200">🔒 Private room conversation</p>}
    <div className="min-h-0 flex-1 overflow-auto text-xs">
      {messages.length === 0 ? <p className="opacity-60">{synced ? "No messages yet." : "Conversation is saved locally until the Office service is available."}</p> : messages.map((message, index) => <p key={`${message.id ?? message.clientId ?? message.at}-${index}`} className="mb-2"><strong>{message.from}: </strong>{message.text}<time className="ml-1 text-[10px] opacity-45" dateTime={new Date(message.at).toISOString()}>{new Date(message.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><button className="ml-1 opacity-45 hover:opacity-100" aria-label="Speak message" title="Speak message" onClick={() => speakMessage(message.text)}>◖</button>{message.delivery && <span className="ml-1 text-[10px] opacity-55">{message.delivery === "sending" ? "Sending…" : "Saved locally"}</span>}{message.delivery === "local" && <button className="ml-1 text-[10px] text-blue-300 hover:text-blue-100" onClick={() => retry(message)}>Retry</button>}{message.id && <><button className="ml-2 opacity-45 hover:opacity-100" aria-label="Remove message" onClick={() => remove(message.id!)}>×</button><button className="ml-1 opacity-45 hover:opacity-100" aria-label="Report message" onClick={() => report(message.id!)}>!</button></>}</p>)}
      {typists.length > 0 && <p className="mt-1 italic text-slate-400">{typists.join(", ")} {typists.length === 1 ? "is" : "are"} typing…</p>}
      {agentReplying && <p className="mt-1 italic text-blue-300">{directAgent?.name ?? "Agent"} is replying…</p>}
    </div>
    <form className="mt-2 flex gap-1" onSubmit={event => { event.preventDefault(); send(); }}>
      <input className="min-w-0 flex-1 rounded bg-slate-800 p-2 text-xs" maxLength={1000} value={text} placeholder="Write a message…" onChange={event => announceTyping(event.target.value)} />
      {text && <button className="rounded bg-slate-700 px-2 text-xs" type="button" onClick={clearDraft}>Clear</button>}<button className="rounded bg-blue-700 px-2 text-xs disabled:cursor-wait disabled:opacity-60" disabled={agentReplying} type="submit">Send</button>
    </form>
  </aside>;
}
