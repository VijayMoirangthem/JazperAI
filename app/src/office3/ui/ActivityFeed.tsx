"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { relativeOfficeTime } from "./locale";

type Activity = { ts?: string; agent?: string; action?: string; detail?: string; message?: string };
type ActivityFilter = "all" | "agents" | "office" | "attention";
const activityTone = (item: Activity): { icon: string; tone: string; label: string } => { const text = `${item.action ?? ""} ${item.detail ?? ""} ${item.message ?? ""}`.toLowerCase(); if (/(error|fail|blocked|incident|alert)/.test(text)) return { icon: "!", tone: "text-rose-200", label: "Needs attention" }; if (/(approval|approved|denied|escalat)/.test(text)) return { icon: "✓", tone: "text-amber-200", label: "Approval" }; if (/(done|complete|finished|shipped)/.test(text)) return { icon: "✓", tone: "text-emerald-200", label: "Completed" }; if (/(task|dispatch|assign|move)/.test(text)) return { icon: "→", tone: "text-blue-200", label: "Task" }; return { icon: "•", tone: "text-slate-200", label: "Activity" }; };

export function ActivityFeed({ onClose, onGo }: { onClose(): void; onGo?(slug: string): void }) {
  const [items, setItems] = useState<Activity[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const load = useCallback(async (showProgress = false) => {
    if (showProgress) setRefreshing(true);
    try {
      const response = await fetch("/api/hive/activity?limit=40");
      const value = await response.json();
      setItems(value.activities ?? []);
    } catch { /* retain stale activity while the local backend reconnects */
    } finally { if (showProgress) setRefreshing(false); }
  }, []);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [load]);
  const visibleItems = items.filter(item => filter === "all" || (filter === "agents" ? Boolean(item.agent) : filter === "office" ? !item.agent : activityTone(item).label === "Needs attention"));
  const summary = useMemo(() => {
    const attention = items.filter(item => activityTone(item).label === "Needs attention").length;
    const agents = items.filter(item => Boolean(item.agent)).length;
    return { attention, agents };
  }, [items]);
  return <aside className="absolute right-3 top-14 z-40 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-xl bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-white/15">
    <button className="float-right text-xs opacity-70" onClick={onClose}>Close</button>
    <div className="mb-3 flex items-center gap-2 pr-10"><h2 className="text-sm font-semibold">Activity feed</h2><button className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] opacity-80 hover:bg-white/10 disabled:opacity-40" disabled={refreshing} onClick={() => void load(true)}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>
    <div className="mb-2 flex gap-1" role="group" aria-label="Activity scope">{(["all", "agents", "office", "attention"] as ActivityFilter[]).map(scope => <button key={scope} className={`rounded px-2 py-1 text-[10px] ${filter === scope ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`} aria-pressed={filter === scope} onClick={() => setFilter(scope)}>{scope === "all" ? "All" : scope === "agents" ? "Agents" : scope === "office" ? "Office" : "Attention"}</button>)}</div>
    <p className="mb-2 text-[10px] text-slate-400" aria-live="polite">{items.length} recent · {summary.agents} agent update{summary.agents === 1 ? "" : "s"}{summary.attention ? ` · ${summary.attention} need${summary.attention === 1 ? "s" : ""} attention` : ""}</p>
    {visibleItems.length === 0 ? <p className="text-xs opacity-60">{items.length ? "No activity matches this filter." : "No recent activity."}</p> : visibleItems.map((item, index) => { const tone = activityTone(item); return <button key={`${item.ts || ""}-${index}`} type="button" disabled={!item.agent || !onGo} className="block w-full border-b border-white/10 py-2 text-left text-xs disabled:cursor-default hover:enabled:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300" onClick={() => { if (item.agent) onGo?.(item.agent); }}><div className="flex items-baseline justify-between gap-2"><span className={`mr-1 inline-block w-3 text-center font-bold ${tone.tone}`} aria-label={tone.label}>{tone.icon}</span><span className="font-medium">{item.agent || "Office"} · {item.action || "activity"}</span><time className="ml-auto shrink-0 text-[10px] opacity-50" dateTime={item.ts}>{relativeOfficeTime(item.ts)}</time></div><div className="mt-1 flex items-center gap-1"><span className={`rounded bg-white/10 px-1 py-0.5 text-[9px] ${tone.tone}`}>{tone.label}</span><span className="min-w-0 truncate opacity-65">{item.detail || item.message || "Updated"}</span></div>{item.agent && <div className="mt-1 text-[10px] text-blue-300">Focus in office</div>}</button>; })}
  </aside>;
}
