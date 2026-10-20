"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { ringColor } from "@/office2/behavior";
import { portraitUrl } from "@/office2/avatarSheet";
import { CREW_COLOR } from "@/office2/look";
import type { OfficeScene } from "@/office2/OfficeScene";
import type { Look, Person } from "@/office2/types";

interface Card {
  display_name?: string; role_title?: string; position?: string; department?: string; group_label?: string; reports_to?: string;
  lifecycle?: string; tier?: string; tools?: unknown[]; memory_namespace?: string; settings?: { model?: string }; prompt?: string;
  calls?: number; errors?: number; score?: number | null; grade?: string;
}

export interface IdCardProps {
  api: string; scene: OfficeScene; person: Person; look: Look; state: string; bubble: string | null;
  onClose(): void; onChat(): void; onFocus(): void; onFollow(): void; onEdit?(): void; onDisable?(): void;
}

export function IdCard({ api, scene, person, look, state, bubble, onClose, onChat, onFocus, onFollow, onEdit, onDisable }: IdCardProps) {
  const [card, setCard] = useState<Card | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  useEffect(() => {
    setCard(null);
    if (person.kind !== "bot") return;
    let live = true;
    fetch(`${api}/api/v1/bots/${person.slug}/card`).then((r) => (r.ok ? r.json() : null)).then((c) => { if (live) setCard(c as Card | null); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, person.slug, person.kind]);
  const portrait = useMemo(() => portraitUrl(scene, look), [scene, look]);
  const dot = "#" + ringColor(state).toString(16).padStart(6, "0");
  const row = (k: string, v: unknown) => (v === undefined || v === null || v === "" ? null : <div className="flex justify-between gap-3"><span className="opacity-50">{k}</span><span className="truncate text-right">{String(v)}</span></div>);

  return (
    <div data-testid="office2-idcard" className="absolute right-3 top-14 z-10 w-80 rounded-2xl bg-black/85 p-4 text-sm ring-1 ring-white/20 backdrop-blur">
      <button aria-label="Close" className="absolute right-3 top-3 opacity-70 hover:opacity-100" onClick={onClose}><X size={14} /></button>
      <img src={portrait} alt="" className="mx-auto h-32 w-32" style={{ imageRendering: "pixelated" }} />
      <div className="mt-1 text-center text-base font-semibold">{card?.display_name ?? person.name}</div>
      <div className="text-center text-xs opacity-70">{card?.position ?? person.role}</div>
      <div className="mt-2 flex flex-wrap justify-center gap-2 text-[11px]">
        <span className="rounded px-2 py-0.5 text-black" style={{ background: CREW_COLOR[person.crew] ?? CREW_COLOR.unmapped }}>{person.crew}</span>
        <span className="flex items-center gap-1 rounded bg-white/10 px-2 py-0.5"><span className="h-2 w-2 rounded-full" style={{ background: dot }} />{state}</span>
        {person.lifecycle && <span className="rounded bg-white/10 px-2 py-0.5">{person.lifecycle}</span>}
      </div>
      {bubble && <div className="mt-2 rounded bg-white/10 px-2 py-1 text-xs italic">{bubble}</div>}
      <div className="mt-3 space-y-1 text-xs">
        {row("Group", card?.group_label)}{row("Department", card?.department)}{row("Reports to", card?.reports_to)}{row("Model tier", card?.tier)}
        {row("Model", card?.settings?.model)}{row("Tools", card?.tools?.length)}{row("Memory", card?.memory_namespace)}
        {row("Score", card?.score != null ? `${card.score}${card.grade ? ` (${card.grade})` : ""}` : undefined)}{row("Calls / errors", card?.calls != null ? `${card.calls} / ${card.errors ?? 0}` : undefined)}
      </div>
      {card?.prompt && (
        <div className="mt-2 text-xs">
          <button className="underline opacity-70" onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide prompt" : "Show prompt"}</button>
          {showPrompt && <div className="mt-1 max-h-28 overflow-auto rounded bg-white/5 p-2 opacity-80">{card.prompt.slice(0, 280)}{card.prompt.length > 280 ? "…" : ""}</div>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        {person.kind === "bot" && <button onClick={onChat} className="rounded bg-blue-600 px-3 py-1">Chat</button>}
        <button onClick={onFocus} className="rounded border px-3 py-1">Focus</button>
        <button onClick={onFollow} className="rounded border px-3 py-1">Follow</button>
        {person.kind === "bot" && onEdit && <button onClick={onEdit} className="rounded border px-3 py-1">Edit</button>}
        {person.kind === "bot" && onDisable && <button onClick={onDisable} className="rounded border border-red-500/50 px-3 py-1 text-red-300">Disable</button>}
      </div>
    </div>
  );
}
