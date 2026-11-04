"use client";

import { useEffect, useState } from "react";

type Tip = { id: string; text: string };
const storageKey = "office3.feature-tips.dismissed";

const readDismissed = () => {
  try { const value = JSON.parse(localStorage.getItem(storageKey) ?? "[]"); return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []); } catch { return new Set<string>(); }
};

export function FeatureTips() {
  const [queue, setQueue] = useState<Tip[]>([]);
  useEffect(() => {
    const show = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object") return;
      const value = detail as Partial<Tip>;
      if (typeof value.id !== "string" || typeof value.text !== "string" || readDismissed().has(value.id)) return;
      setQueue(current => current.some(tip => tip.id === value.id) ? current : [...current, { id: String(value.id), text: String(value.text) }]);
    };
    window.addEventListener("office3:feature-tip", show);
    return () => window.removeEventListener("office3:feature-tip", show);
  }, []);
  const tip = queue[0];
  if (!tip) return null;
  const dismiss = () => { const dismissed = readDismissed(); dismissed.add(tip.id); localStorage.setItem(storageKey, JSON.stringify([...dismissed])); setQueue(current => current.slice(1)); };
  return <aside role="status" className="absolute bottom-20 right-3 z-30 max-w-72 rounded-lg bg-slate-950/95 p-3 text-xs text-white shadow-xl ring-1 ring-white/15"><p className="leading-5 text-slate-200">{tip.text}</p>{queue.length > 1 && <p className="mt-1 text-[10px] text-slate-400">{queue.length - 1} more tip{queue.length === 2 ? "" : "s"} queued</p>}<button className="mt-2 rounded bg-slate-800 px-2 py-1 text-[11px] hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300" onClick={dismiss}>Got it</button></aside>;
}
