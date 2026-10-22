"use client";
import { useEffect, useState } from "react";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
type Thread = { thread: string; from_slug: string; to_slug: string; kind: string; preview: string };

export function AgentThreadsDrawer({ onClose, onFocus }: { onClose(): void; onFocus(slug: string): void }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  useEffect(() => { let active = true; const load = () => fetch(`${API}/api/v1/comms/threads`).then(response => response.ok ? response.json() : { threads: [] }).then(value => { if (active) setThreads(value.threads ?? []); }).catch(() => undefined); load(); const timer = window.setInterval(load, 3000); return () => { active = false; window.clearInterval(timer); }; }, []);
  return <aside className="absolute right-3 top-14 z-40 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-xl bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><h2 className="mb-3 text-sm font-semibold">Agent conversations</h2>{threads.length === 0 ? <p className="text-xs opacity-60">No active agent threads.</p> : threads.map(thread => <button key={thread.thread} className="block w-full border-b border-white/10 py-3 text-left text-xs hover:bg-white/5" onClick={() => onFocus(thread.from_slug)}><div className="font-medium">{thread.from_slug} → {thread.to_slug} <span className="opacity-50">{thread.kind}</span></div><p className="mt-1 line-clamp-2 opacity-70">{thread.preview}</p></button>)}</aside>;
}
