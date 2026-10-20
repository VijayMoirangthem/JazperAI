"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Home, LocateFixed, UserPlus, ZoomIn, ZoomOut } from "lucide-react";
import { EditDialog } from "@/components/office2/EditDialog";
import { IdCard } from "@/components/office2/IdCard";
import { Minimap } from "@/components/office2/Minimap";
import { ProximityChip } from "@/components/office2/ProximityChip";
import { useApi } from "@/lib/swr";
import { useViewActive } from "@/lib/viewActive";
import { hashParams } from "@/office2/constants";
import { bindLive } from "@/office2/liveBridge";
import { readLooks } from "@/office2/lookStore";
import type { OfficeHandle } from "@/office2/OfficeScene";
import { makeSimPeople, peopleSignature, toPeople, type DirectoryLike, type RosterLike } from "@/office2/people";
import { useChatIntent } from "@/stores/chatIntentStore";
import { useLiveAgents } from "@/stores/liveAgentsStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";

export function Office2Panel() {
  const host = useRef<HTMLDivElement>(null);
  const handleRef = useRef<OfficeHandle | null>(null);
  const [handle, setHandle] = useState<OfficeHandle | null>(null);
  const active = useViewActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const [near, setNear] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"add" | "edit" | null>(null);
  const [looksTick, setLooksTick] = useState(0);

  const connect = useLiveAgents((s) => s.connect);
  const live = useLiveAgents((s) => s.agents);
  useEffect(() => connect(WS_URL), [connect]);

  const { data: directory } = useApi<DirectoryLike>(`${API}/api/v1/directory/`, { ttl: 30000, poll: 30000 });
  const { data: roster } = useApi<RosterLike>(`${API}/api/v1/bots/`, { ttl: 5000, poll: 5000 });
  const people = useMemo(() => {
    const sim = Number(hashParams().get("bots") ?? 0);
    return [...toPeople(directory, roster), ...(sim > 0 ? makeSimPeople(sim) : [])];
  }, [directory, roster]);
  const sig = peopleSignature(people);
  const peopleRef = useRef(people);
  peopleRef.current = people;

  // One Phaser game per mount. Data changes go through handle methods; the game is never rebuilt for them.
  useEffect(() => {
    let cancelled = false;
    let h: OfficeHandle | null = null;
    let unbind: (() => void) | null = null;
    (async () => {
      const { startOffice } = await import("@/office2/OfficeScene");
      if (cancelled || !host.current) return;
      h = await startOffice(host.current);
      if (cancelled) { h.destroy(); return; }
      handleRef.current = h;
      if (!activeRef.current) h.setActive(false);
      h.syncPeople(peopleRef.current, readLooks());
      unbind = bindLive(h.scene);
      h.scene.events.on("proximity", (others: string[]) => setNear(others));
      h.scene.events.on("toast", (t: string) => { setToast(t); setTimeout(() => setToast(null), 2000); });
      h.scene.events.on("avatar-select", (slug: string) => setSelected(slug));
      setHandle(h);
    })();
    return () => { cancelled = true; unbind?.(); h?.destroy(); handleRef.current = null; setHandle(null); };
  }, []);

  useEffect(() => { handleRef.current?.syncPeople(peopleRef.current, readLooks()); }, [sig, looksTick]);
  // hidden tab: stop the render loop (the panel stays mounted so coming back is instant)
  useEffect(() => { handleRef.current?.setActive(active); }, [active]);

  const byslug = useMemo(() => new Map(people.map((p) => [p.slug, p])), [people]);
  const talk = useCallback((slug: string) => {
    const p = byslug.get(slug);
    if (!p) return;
    useChatIntent.getState().open({ id: `dm:${slug}`, label: p.name, kind: "dm", crew: p.crew });
    window.location.hash = "team_chat";
  }, [byslug]);

  const person = selected ? byslug.get(selected) : undefined;
  const avatar = selected ? handle?.scene.avatars.avatars.get(selected) : undefined;
  const closeCard = () => { setSelected(null); handle?.scene.avatars.select(null); };
  const disable = async () => {
    if (!person || !window.confirm(`Disable ${person.name}?`)) return;
    await fetch(`${API}/api/v1/bots/${person.slug}`, { method: "DELETE" });
    closeCard();
  };

  return (
    <div className="relative h-full min-h-[560px] w-full">
      <div ref={host} data-testid="office2-host" className="absolute inset-0" />
      {handle && (
        <>
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-xl bg-black/60 px-2 py-1 text-xs ring-1 ring-white/15">
            <button title="Zoom in (+)" aria-label="Zoom in" onClick={() => handle.scene.rig.zoomIn()}><ZoomIn size={16} /></button>
            <button title="Zoom out (-)" aria-label="Zoom out" onClick={() => handle.scene.rig.zoomOut()}><ZoomOut size={16} /></button>
            <button title="Home (Home)" aria-label="Home" onClick={() => handle.scene.rig.home()}><Home size={16} /></button>
            <button title="Follow me (F)" aria-label="Follow" onClick={() => handle.scene.rig.toggleFollow()}><LocateFixed size={16} /></button>
            <button className="ml-1 flex items-center gap-1 rounded border border-white/20 px-2 py-0.5" onClick={() => setDialog("add")}><UserPlus size={13} />Add employee</button>
          </div>
          <Minimap handle={handle} />
          <ProximityChip names={near.map((s) => ({ slug: s, name: byslug.get(s)?.name.split(" ")[0] ?? s }))} onTalk={talk} />
          {toast && <div className="absolute bottom-16 left-1/2 -translate-x-1/2 rounded bg-black/80 px-3 py-1 text-xs">{toast}</div>}
          {person && avatar && (
            <IdCard api={API} scene={handle.scene} person={person} look={avatar.look} state={live[person.slug]?.state ?? avatar.state}
              bubble={handle.scene.bubbles.of(person.slug)?.text ?? null} onClose={closeCard} onChat={() => talk(person.slug)}
              onFocus={() => handle.scene.rig.focusRoomById(handle.scene.model.roomAt(Math.floor(avatar.sprite.x / 32), Math.floor(avatar.sprite.y / 32)) ?? "")}
              onFollow={() => handle.scene.rig.followAvatar(avatar.sprite)} onEdit={() => setDialog("edit")} onDisable={disable} />
          )}
          {dialog && (
            <EditDialog api={API} scene={handle.scene} mode={dialog} person={dialog === "edit" ? person : undefined}
              existingSlugs={people.map((p) => p.slug)} onClose={() => setDialog(null)}
              onDone={() => { setDialog(null); setLooksTick((n) => n + 1); }} />
          )}
        </>
      )}
    </div>
  );
}
