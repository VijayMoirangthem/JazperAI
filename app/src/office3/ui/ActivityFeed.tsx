"use client";
import { useEffect, useState } from "react";
type Activity = { ts?: string; agent?: string; action?: string; detail?: string; message?: string };
export function ActivityFeed({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<Activity[]>([]);
  useEffect(() => { let live = true; const load = () => fetch("/api/hive/activity?limit=40").then(response => response.json()).then(value => { if (live) setItems(value.activities ?? []); }).catch(() => undefined); load(); const timer = window.setInterval(load, 3000); return () => { live = false; window.clearInterval(timer); }; }, []);
  return <aside className="absolute right-3 top-14 z-40 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-xl bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><h2 className="mb-3 text-sm font-semibold">Activity feed</h2>{items.length === 0 ? <p className="text-xs opacity-60">No recent activity.</p> : items.map((item, index) => <article key={`${item.ts || ""}-${index}`} className="border-b border-white/10 py-2 text-xs"><div className="font-medium">{item.agent || "Office"} · {item.action || "activity"}</div><div className="mt-1 opacity-65">{item.detail || item.message || "Updated"}</div></article>)}</aside>;
}
