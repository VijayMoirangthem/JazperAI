"use client";

import { useEffect, useMemo, useState } from "react";
import { conversationTitle, type ConversationMessage } from "../core/conversationChat";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const keyFor = (members: readonly string[]) => `office3.conversation.${[...members].sort().join(".")}`;
type Member = { slug: string; name: string; kind: "human" | "agent" };
type StoredMessage = ConversationMessage & { id?: number };

export function ConversationDrawer({ members, onClose }: { members: readonly Member[]; onClose(): void }) {
  const participantIds = useMemo(() => members.map(member => member.slug).sort(), [members]);
  const storageKey = useMemo(() => keyFor(participantIds), [participantIds]);
  const conversationId = participantIds.join(".");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [text, setText] = useState("");
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    let stopped = false;
    const fallback = () => {
      try { if (!stopped) setMessages(JSON.parse(localStorage.getItem(storageKey) ?? "[]")); }
      catch { if (!stopped) setMessages([]); }
    };
    const load = () => fetch(`${API}/api/v1/office/conversations?participants=${encodeURIComponent(participantIds.join(","))}`)
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(value => {
        if (stopped) return;
        setMessages((value.messages ?? []).map((message: { id: number; sender: string; text: string; at: number }) => ({ id: Number(message.id), from: message.sender, text: message.text, at: Number(message.at) })));
        setSynced(true);
      })
      .catch(fallback);
    load();
    const timer = window.setInterval(load, 3000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [participantIds, storageKey]);

  const send = () => {
    const value = text.trim();
    if (!value) return;
    const sender = members.find(member => member.kind === "human")?.slug ?? "founder";
    const local: StoredMessage = { from: sender, text: value, at: Date.now() };
    const saveLocal = () => setMessages(current => {
      const next = [...current, local].slice(-100);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
    fetch(`${API}/api/v1/office/conversations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participants: participantIds, sender, text: value, role: "founder" }),
    }).then(response => response.ok ? response.json() : Promise.reject())
      .then(value => {
        const message = value.message;
        setMessages(current => [...current, { id: Number(message.id), from: message.sender, text: message.text, at: Number(message.at) }].slice(-100));
        setSynced(true);
      }).catch(saveLocal);
    setText("");
  };
  const remove = (id: number) => {
    fetch(`${API}/api/v1/office/conversations/${encodeURIComponent(conversationId)}/${id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: "founder" }),
    }).then(response => {
      if (!response.ok) throw Error("delete failed");
      setMessages(current => current.filter(message => message.id !== id));
    }).catch(() => window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Message could not be removed.", priority: "error" } })));
  };

  return <aside className="absolute bottom-14 right-3 z-40 flex h-80 w-80 flex-col rounded-xl bg-slate-950/95 p-3 text-white shadow-2xl ring-1 ring-white/15">
    <button className="float-right self-end text-xs opacity-70" onClick={onClose}>Close</button>
    <h2 className="mb-2 text-sm font-semibold">{conversationTitle(members.map(member => member.name))}</h2>
    <div className="min-h-0 flex-1 overflow-auto text-xs">
      {messages.length === 0 ? <p className="opacity-60">{synced ? "No messages yet." : "Conversation is saved locally until the Office service is available."}</p> : messages.map((message, index) => <p key={`${message.id ?? message.at}-${index}`} className="mb-2"><strong>{message.from}: </strong>{message.text}{message.id && <button className="ml-2 opacity-45 hover:opacity-100" aria-label="Remove message" onClick={() => remove(message.id!)}>×</button>}</p>)}
    </div>
    <form className="mt-2 flex gap-1" onSubmit={event => { event.preventDefault(); send(); }}>
      <input className="min-w-0 flex-1 rounded bg-slate-800 p-2 text-xs" maxLength={1000} value={text} placeholder="Write a message…" onChange={event => setText(event.target.value)} />
      <button className="rounded bg-blue-700 px-2 text-xs" type="submit">Send</button>
    </form>
  </aside>;
}
