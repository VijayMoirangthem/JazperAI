"use client";
import { useEffect, useState } from "react";
import { THEMES } from "../core/themes";

export function ThemePicker({ onChange }: { onChange(id: string): void }) {
  const [selected, setSelected] = useState("tech-startup");
  useEffect(() => setSelected(localStorage.getItem("office3.theme") ?? "tech-startup"), []);
  return <details className="absolute bottom-3 right-3 z-20 w-52 rounded-lg bg-black/70 p-2 text-xs text-white ring-1 ring-white/15"><summary className="cursor-pointer">Environment</summary><div className="mt-2 grid grid-cols-2 gap-1">{THEMES.map(theme => <button key={theme.id} type="button" aria-pressed={selected === theme.id} aria-label={`Use ${theme.label} environment`} onClick={() => { setSelected(theme.id); onChange(theme.id); }} className={`overflow-hidden rounded text-left outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300 ${selected === theme.id ? "ring-2 ring-blue-400" : "hover:ring-1 hover:ring-white/40"}`}><span className="block h-9 p-1" style={{ background: `linear-gradient(150deg, ${theme.sky} 0 52%, ${theme.wall} 53% 66%, ${theme.floor} 67%)` }}><i className="block h-1.5 w-1.5 rounded-full" style={{ background: theme.accent }} /></span><span className="flex items-center gap-1 px-1.5 py-1"><i className="h-2 w-2 shrink-0 rounded-full" style={{ background: theme.accent }} /><span className="truncate">{theme.label}</span></span></button>)}</div></details>;
}
