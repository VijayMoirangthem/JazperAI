"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CheckCheck, Hash, Send, User } from "lucide-react";
import { useLiveAgents } from "@/stores/liveAgentsStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";

interface RosterBot {
  slug: string;
  display_name: string;
  role_title: string;
  crew: string;
  enabled: boolean;
  source: string;
}
interface Msg {
  id: number;
  from: string; // "you" or an agent slug
  text: string;
  status?: "sent" | "delivered" | "read";
}
type Channel = { id: string; label: string; kind: "dm" | "group"; crew?: string };

const GROUPS: Channel[] = [
  { id: "g:create_origins", label: "Create Origins HQ", kind: "group" },
  { id: "g:baeit", label: "Baeit Engineering", kind: "group", crew: "baeit" },
  { id: "g:boardmint", label: "Boardmint Compliance", kind: "group", crew: "boardmint" },
];

let nextId = 1;

export function TeamChatPanel() {
  const [roster, setRoster] = useState<RosterBot[]>([]);
  const [active, setActive] = useState<Channel>({ id: "dm:jasper", label: "Sir Jasper", kind: "dm" });
  const [threads, setThreads] = useState<Record<string, Msg[]>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useLiveAgents((s) => s.agents);
  const connect = useLiveAgents((s) => s.connect);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => connect(WS_URL), [connect]);
  useEffect(() => {
    fetch(`${API}/api/v1/bots/`).then((r) => r.json()).then((d) => setRoster(d.bots ?? [])).catch(() => undefined);
    try {
      const saved = localStorage.getItem("jasper.teamchat");
      if (saved) setThreads(JSON.parse(saved));
    } catch { /* storage unavailable */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("jasper.teamchat", JSON.stringify(threads)); } catch { /* ignore */ }
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [threads, active]);

  const dms = useMemo(() => roster.filter((b) => b.enabled && b.slug !== "jasper"), [roster]);
  const msgs = threads[active.id] ?? [];
  const typing = Object.values(live).filter((a) => a.state === "working" || a.state === "planning").map((a) => a.slug);

  const push = (channel: string, m: Omit<Msg, "id">) =>
    setThreads((t) => ({ ...t, [channel]: [...(t[channel] ?? []), { ...m, id: nextId++ }] }));
  const mark = (channel: string, id: number, status: Msg["status"]) =>
    setThreads((t) => ({ ...t, [channel]: (t[channel] ?? []).map((m) => (m.id === id ? { ...m, status } : m)) }));

  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    const ch = active.id;
    setDraft("");
    setBusy(true);
    const id = nextId;
    push(ch, { from: "you", text, status: "sent" });
    try {
      const slug = ch.startsWith("dm:") ? ch.slice(3) : null;
      const dynamic = slug && roster.find((b) => b.slug === slug && b.source === "dynamic");
      if (dynamic) {
        const r = await fetch(`${API}/api/v1/bots/${slug}/message`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
        }).then((x) => x.json());
        mark(ch, id, "read");
        push(ch, { from: slug!, text: r.reply });
      } else {
        const prefix = active.kind === "group" ? `[${active.label}] ` : "";
        const r = await fetch(`${API}/api/v1/directive/`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: prefix + text }),
        }).then((x) => x.json());
        mark(ch, id, "delivered");
        for (const [agent, reply] of Object.entries((r.results ?? {}) as Record<string, string>)) push(ch, { from: agent, text: reply });
        mark(ch, id, "read");
      }
    } catch {
      push(ch, { from: "system", text: "Could not reach the backend." });
    } finally {
      setBusy(false);
    }
  };

  const item = (c: Channel, sub?: string) => (
    <button key={c.id} onClick={() => setActive(c)}
      className="w-full text-left px-3 py-2 flex items-center gap-2 rounded"
      style={{ background: active.id === c.id ? "rgba(255,255,255,0.08)" : "transparent" }}>
      {c.kind === "group" ? <Hash size={14} /> : <User size={14} />}
      <span className="truncate text-sm">{c.label}</span>
      {sub && <span className="ml-auto text-xs opacity-50">{sub}</span>}
    </button>
  );

  return (
    <div className="flex h-full min-h-[560px]">
      <aside className="w-64 border-r p-2 space-y-1 overflow-y-auto">
        <div className="text-xs uppercase opacity-50 px-3 pt-1">Channels</div>
        {GROUPS.map((g) => item(g))}
        <div className="text-xs uppercase opacity-50 px-3 pt-3">Direct</div>
        {item({ id: "dm:jasper", label: "Sir Jasper", kind: "dm" }, live["jasper"]?.state)}
        {dms.map((b) => item({ id: `dm:${b.slug}`, label: b.display_name, kind: "dm" }, live[b.slug]?.state))}
      </aside>
      <section className="flex-1 flex flex-col">
        <header className="px-4 py-3 border-b font-semibold">{active.label}</header>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {msgs.length === 0 && <p className="text-sm opacity-60">No messages yet. Say hello.</p>}
          {msgs.map((m) => (
            <div key={m.id} className={`flex ${m.from === "you" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[70%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
                style={{ background: m.from === "you" ? "#1d4ed8" : "rgba(255,255,255,0.08)" }}>
                {m.from !== "you" && <div className="text-xs opacity-60 mb-0.5">{m.from}</div>}
                {m.text}
                {m.from === "you" && (
                  <span className="ml-2 inline-block align-middle opacity-70">
                    {m.status === "read" ? <CheckCheck size={12} /> : <Check size={12} />}
                  </span>
                )}
              </div>
            </div>
          ))}
          {typing.length > 0 && <div className="text-xs opacity-60">{typing.join(", ")} typing…</div>}
          <div ref={endRef} />
        </div>
        <footer className="p-3 border-t flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={`Message ${active.label}`} className="flex-1 rounded border bg-transparent px-3 py-2 text-sm" />
          <button onClick={send} disabled={busy} className="px-3 rounded border"><Send size={16} /></button>
        </footer>
      </section>
    </div>
  );
}
