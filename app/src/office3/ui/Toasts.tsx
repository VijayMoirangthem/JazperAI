"use client";
import { useEffect, useRef, useState } from "react";

type ToastAction = { label: string; run: () => void };
export type OfficeToast = { id?: string; text: string; priority?: "info" | "success" | "warning" | "error"; action?: ToastAction; actions?: readonly ToastAction[] };
const tone = { info: "bg-slate-800", success: "bg-emerald-900", warning: "bg-amber-900", error: "bg-rose-900" };

export function Toasts({ enabled = true, doNotDisturb = false }: { enabled?: boolean; doNotDisturb?: boolean }) {
  const [items, setItems] = useState<(OfficeToast & { id: string })[]>([]);
  const enabledRef = useRef(enabled);
  const doNotDisturbRef = useRef(doNotDisturb);
  enabledRef.current = enabled;
  doNotDisturbRef.current = doNotDisturb;
  useEffect(() => { if (doNotDisturb) setItems(current => current.filter(item => item.priority === "error")); }, [doNotDisturb]);
  useEffect(() => {
    const onToast = (event: Event) => {
      const toast = (event as CustomEvent<OfficeToast>).detail;
      if (!toast?.text) return;
      if ((!enabledRef.current || doNotDisturbRef.current) && toast.priority !== "error") return;
      const id = toast.id ?? `${toast.priority ?? "info"}:${toast.text}`;
      setItems(current => [{ ...toast, id }, ...current.filter(item => item.id !== id)].slice(0, 3));
      window.setTimeout(() => setItems(current => current.filter(item => item.id !== id)), toast.priority === "error" ? 7000 : 4200);
    };
    window.addEventListener("office3:toast", onToast);
    return () => window.removeEventListener("office3:toast", onToast);
  }, []);
  return <section className="pointer-events-none absolute right-3 top-14 z-50 flex w-80 flex-col gap-2">{items.map(item => { const actions = item.actions ?? (item.action ? [item.action] : []); const dismiss = () => setItems(current => current.filter(entry => entry.id !== item.id)); return <article key={item.id} role={item.priority === "error" ? "alert" : "status"} aria-live={item.priority === "error" ? "assertive" : "polite"} className={`pointer-events-auto rounded-lg px-3 py-2 text-xs text-white shadow-xl ring-1 ring-white/15 ${tone[item.priority ?? "info"]}`}><span>{item.text}</span>{actions.map(action => <button key={action.label} type="button" className="ml-2 rounded bg-white/15 px-2 py-1 font-medium hover:bg-white/25" onClick={() => { action.run(); dismiss(); }}>{action.label}</button>)}</article>; })}</section>;
}
