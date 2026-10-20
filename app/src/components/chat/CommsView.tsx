"use client";

// Read-only window onto what bots say to each other and which tools they call (Jasper <-> Herald <-> Connector, meetings...).
// Live feed comes from the Redis stream behind /api/v1/comms/recent; history from Postgres.
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Wrench } from "lucide-react";
import { MausAvatar, lookFor, useBotLook } from "@/mascot/MausAvatar";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export interface CommsThread { thread: string; from_slug: string; to_slug: string; kind: string; preview: string; ts: string; n: number }
interface Msg { id: number; ts: string; from_slug: string; to_slug: string; kind: string; text: string }

export const threadTitle = (t: string) => (t.startsWith("meeting:") || t.startsWith("meeting|") ? "Meeting · " + t.split(/[:|]/)[1] : t.endsWith("|tools") ? t.split("|")[0] + " · tool calls" : t.split("|").join(" ⇄ "));

export function useCommsThreads(): CommsThread[] {
  const [threads, setThreads] = useState<CommsThread[]>([]);
  useEffect(() => {
    const load = () => fetch(`${API}/api/v1/comms/threads`).then((r) => r.json()).then((d) => setThreads(d.threads ?? [])).catch(() => undefined);
    void load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);
  return threads;
}

export function CommsView({ thread, includeTools = true }: { thread: string; includeTools?: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const looks = useBotLook((s) => s.looks);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMsgs([]);
    let last = 0, stop = false;
    const tick = async () => {
      try {
        const d = await fetch(`${API}/api/v1/comms/thread?id=${encodeURIComponent(thread)}&since_id=${last}`).then((r) => r.json());
        const fresh: Msg[] = d.messages ?? [];
        if (!stop && fresh.length) { last = fresh[fresh.length - 1].id; setMsgs((m) => [...m, ...fresh]); }
      } catch { /* backend busy */ }
    };
    void tick();
    const t = setInterval(tick, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [thread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [msgs.length]);
  const tools = thread.endsWith("|tools");
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col" data-testid="comms-view">
      <header className="flex items-center gap-3 border-b border-white/10 px-5 py-3">
        <span className="text-[17px] font-semibold">{threadTitle(thread)}</span>
        <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs opacity-70">observing · read-only</span>
      </header>
      <div className="flex-1 space-y-2.5 overflow-y-auto px-5 py-4">
        {msgs.length === 0 && <p className="pt-10 text-center text-sm opacity-60">Nothing here yet.</p>}
        {msgs.filter((m) => includeTools || m.kind !== "tool").map((m) => {
          const isTool = m.to_slug.startsWith("tool:") || m.kind === "result" || m.kind === "tool";
          const look = lookFor(looks, m.from_slug);
          return (
            <div key={m.id} className="flex items-start gap-2.5" data-testid="comms-msg">
              <MausAvatar color={look.color} bodyId={look.body} size={30} state="idle" trackPointer={false} />
              <div className="min-w-0 max-w-[80%]">
                <div className="flex items-center gap-1.5 text-[11px] opacity-60">
                  <b className="text-white/90">{m.from_slug}</b>
                  {!tools && !m.to_slug.startsWith("meeting:") && <><ArrowRight size={10} />{m.to_slug}</>}
                  <span>· {m.kind}</span><span>· {new Date(m.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                </div>
                <div className={`mt-0.5 whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] ${isTool ? "bg-black/30 font-mono text-[12px]" : "bg-white/8"}`}
                  style={{ background: isTool ? undefined : "rgba(255,255,255,0.08)" }}>
                  {isTool && <Wrench size={11} className="mr-1 inline opacity-60" />}{m.text}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
