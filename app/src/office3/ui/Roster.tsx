"use client";
import { useMemo, useState } from "react";
type Person = { slug: string; name: string; kind: string };
export function Roster({ people, onGo, onClose }: { people: Person[]; onGo(slug: string): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => people.filter(person => `${person.name} ${person.slug}`.toLowerCase().includes(query.toLowerCase())), [people, query]);
  return <aside className="absolute left-3 top-14 z-30 w-72 rounded-xl bg-slate-950/95 p-3 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><h2 className="mb-2 text-sm font-semibold">Office roster</h2><input autoFocus className="mb-2 w-full rounded bg-slate-800 p-2 text-xs" placeholder="Find someone…" value={query} onChange={event => setQuery(event.target.value)} />{visible.map(person => <div key={person.slug} className="flex items-center gap-2 border-t border-white/10 py-2 text-xs"><span className="h-2 w-2 rounded-full bg-emerald-400"/><span className="min-w-0 flex-1 truncate">{person.name}</span><button className="rounded bg-slate-700 px-2 py-1" onClick={() => onGo(person.slug)}>Go to</button></div>)}</aside>;
}
