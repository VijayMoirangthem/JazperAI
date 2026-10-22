"use client";
import { useEffect, useState } from "react";

type Minutes = { id: number; room_id: string; participants: string[]; duration_seconds: number; transcript: Array<{ text?: string; content?: string }>; created_at: string };
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function MinutesDrawer({ onClose }: { onClose(): void }) {
  const [items, setItems] = useState<Minutes[]>([]), [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; fetch(`${API}/api/v1/office/minutes`).then(response => response.ok ? response.json() : Promise.reject()).then(value => { if (active) setItems(value.minutes ?? []); }).catch(() => { if (active) setError("Meeting minutes could not be loaded."); }); return () => { active = false; }; }, []);
  return <aside className="absolute right-3 top-14 z-40 max-h-[calc(100%-5rem)] w-80 overflow-auto rounded-xl bg-slate-950/95 p-4 text-white shadow-2xl ring-1 ring-white/15"><button className="float-right text-xs opacity-70" onClick={onClose}>Close</button><h2 className="mb-3 text-sm font-semibold">Meeting minutes</h2>{error && <p className="text-xs text-rose-200">{error}</p>}{!error && items.length === 0 && <p className="text-xs opacity-60">No saved meetings yet.</p>}{items.map(item => <article key={item.id} className="border-b border-white/10 py-3 text-xs"><div className="font-medium">{item.room_id} · {Math.ceil(item.duration_seconds / 60)} min</div><div className="mt-1 opacity-60">{item.participants.join(", ") || "No participants recorded"}</div><p className="mt-2 line-clamp-3 opacity-80">{item.transcript.map(line => line.text ?? line.content ?? "").filter(Boolean).join(" ") || "No transcript recorded."}</p></article>)}</aside>;
}
