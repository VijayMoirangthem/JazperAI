"use client";

import { useEffect, useMemo, useRef } from "react";
import { useApi } from "@/lib/swr";
import { useViewActive } from "@/lib/viewActive";
import { hashParams } from "@/office2/constants";
import type { OfficeHandle } from "@/office2/OfficeScene";
import { makeSimPeople, peopleSignature, toPeople, type DirectoryLike, type RosterLike } from "@/office2/people";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function Office2Panel() {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<OfficeHandle | null>(null);
  const active = useViewActive();
  const activeRef = useRef(active);
  activeRef.current = active;

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
    (async () => {
      const { startOffice } = await import("@/office2/OfficeScene");
      if (cancelled || !host.current) return;
      h = await startOffice(host.current);
      if (cancelled) { h.destroy(); return; }
      handle.current = h;
      if (!activeRef.current) h.setActive(false);
      h.syncPeople(peopleRef.current);
    })();
    return () => { cancelled = true; h?.destroy(); handle.current = null; };
  }, []);

  useEffect(() => { handle.current?.syncPeople(peopleRef.current); }, [sig]);

  // hidden tab: stop the render loop (the panel stays mounted so coming back is instant)
  useEffect(() => { handle.current?.setActive(active); }, [active]);

  return (
    <div className="relative h-full min-h-[560px] w-full">
      <div ref={host} data-testid="office2-host" className="absolute inset-0" />
    </div>
  );
}
