"use client";
import { useLiveAgents } from "@/stores/liveAgentsStore";
export interface VisitPerson { slug: string; name: string; kind: string; state?: string; }
export function VisitCard({ person, onClose }: { person: VisitPerson; onClose(): void }) {
  const live = useLiveAgents(state => state.agents[person.slug]);
  const role = person.kind === "human" ? "Founder" : "Agent";
  const state = live?.state ?? person.state ?? "online";
  const activity = live?.bubble ?? live?.reason ?? person.state ?? "Available";
  return <aside className="absolute left-1/2 top-1/2 z-50 w-80 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-slate-950/95 p-5 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><div className="mb-3 h-12 w-12 rounded-full bg-blue-500/40"/><h2 className="text-lg font-semibold">{person.name}</h2><p className="text-xs text-blue-200">{role} · {state}</p><dl className="mt-4 space-y-2 text-xs"><div><dt className="opacity-50">Office identity</dt><dd>{person.slug}</dd></div><div><dt className="opacity-50">Working on</dt><dd>{activity}</dd></div>{live?.ts && <div><dt className="opacity-50">Last update</dt><dd>{new Date(live.ts).toLocaleTimeString()}</dd></div>}</dl></aside>;
}
