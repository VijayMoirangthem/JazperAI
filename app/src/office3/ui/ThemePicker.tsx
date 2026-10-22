"use client";
import { useEffect, useState } from "react";
import { THEMES } from "../core/themes";

export function ThemePicker({ onChange }: { onChange(id: string): void }) {
  const [selected, setSelected] = useState("tech-startup");
  useEffect(() => setSelected(localStorage.getItem("office3.theme") ?? "tech-startup"), []);
  return <details className="absolute bottom-3 right-3 z-20 w-44 rounded-lg bg-black/70 p-2 text-xs text-white ring-1 ring-white/15"><summary className="cursor-pointer">Environment</summary><div className="mt-2 grid gap-1">{THEMES.map(theme => <button key={theme.id} onClick={() => { setSelected(theme.id); onChange(theme.id); }} className={`flex items-center gap-2 rounded px-2 py-1 text-left ${selected === theme.id ? "bg-blue-600" : "hover:bg-slate-700"}`}><i className="h-3 w-3 rounded-full" style={{ background: theme.accent }} /><span>{theme.label}</span></button>)}</div></details>;
}
