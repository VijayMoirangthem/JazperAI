"use client";
import { useState } from "react";

export function ZoneOverlayToggle({ onChange }: { onChange(visible: boolean): void }) {
  const [visible, setVisible] = useState(false);
  return <button className={`absolute right-3 top-14 z-20 rounded-lg px-2 py-1 text-xs text-white ring-1 ring-white/15 ${visible ? "bg-blue-700" : "bg-black/60"}`} onClick={() => { const next = !visible; setVisible(next); onChange(next); }}>{visible ? "Hide zones" : "Show zones"}</button>;
}
