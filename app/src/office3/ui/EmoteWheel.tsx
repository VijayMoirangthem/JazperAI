"use client";

import { useEffect, useState } from "react";
import { EMOTES, type Emote } from "../core/emotes";

const entries = Object.entries(EMOTES) as [Emote, string][];

/** Compact keyboard-friendly emote picker; the scene remains the single emote executor. */
export function EmoteWheel() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("office3:open-emote-wheel", show);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("office3:open-emote-wheel", show); window.removeEventListener("keydown", close); };
  }, []);
  if (!open) return null;
  return <section className="absolute bottom-16 left-1/2 z-30 grid -translate-x-1/2 grid-cols-3 gap-1 rounded-xl bg-slate-950/95 p-2 text-xs text-white shadow-xl ring-1 ring-white/15" role="dialog" aria-label="Choose an emote">
    {entries.map(([id, icon], index) => <button key={id} className="rounded px-2 py-1 hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" title={`Alt+${index + 1} · ${id}`} onClick={() => { window.dispatchEvent(new CustomEvent("office3:emote", { detail: id })); setOpen(false); }}>{icon} <span className="sr-only">{id}</span></button>)}
    <button className="col-span-3 rounded px-2 py-1 text-slate-300 hover:bg-slate-700" onClick={() => setOpen(false)}>Close</button>
  </section>;
}
