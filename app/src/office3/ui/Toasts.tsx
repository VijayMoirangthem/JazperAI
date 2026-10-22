"use client";
import { useEffect, useState } from "react";

export type OfficeToast = { id?: string; text: string; priority?: "info" | "success" | "warning" | "error"; action?: { label: string; run: () => void } };
const tone = { info: "bg-slate-800", success: "bg-emerald-900", warning: "bg-amber-900", error: "bg-rose-900" };

export function Toasts() {
  const [items, setItems] = useState<(OfficeToast & { id: string })[]>([]);
  useEffect(() => {
    const onToast = (event: Event) => {
      const toast = (event as CustomEvent<OfficeToast>).detail;
      if (!toast?.text) return;
      const id = toast.id ?? `${toast.priority ?? "info"}:${toast.text}`;
      setItems(current => [{ ...toast, id }, ...current.filter(item => item.id !== id)].slice(0, 3));
      window.setTimeout(() => setItems(current => current.filter(item => item.id !== id)), toast.priority === "error" ? 7000 : 4200);
    };
    window.addEventListener("office3:toast", onToast);
    return () => window.removeEventListener("office3:toast", onToast);
  }, []);
  return <section className="pointer-events-none absolute right-3 top-14 z-50 flex w-80 flex-col gap-2" aria-live="polite">{items.map(item => <article key={item.id} className={`pointer-events-auto rounded-lg px-3 py-2 text-xs text-white shadow-xl ring-1 ring-white/15 ${tone[item.priority ?? "info"]}`}><span>{item.text}</span>{item.action && <button className="ml-2 rounded bg-white/15 px-2 py-1 font-medium hover:bg-white/25" onClick={item.action.run}>{item.action.label}</button>}</article>)}</section>;
}
