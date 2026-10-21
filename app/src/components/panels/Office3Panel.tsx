"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/swr";
import { useViewActive } from "@/lib/viewActive";
import { hashParams } from "@/office2/constants";
import { makeSimPeople, peopleSignature, toPeople, type DirectoryLike, type RosterLike } from "@/office2/people";
import { bindLive } from "@/office2/liveBridge";
import type { Office3Handle, Office3Stats } from "@/office3/office3";
import { useLiveAgents } from "@/stores/liveAgentsStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";

/** Office 3 (beta): 3D office spike. Same data and logic as Office 2, different renderer. */
export function Office3Panel() {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<Office3Handle | null>(null);
  const active = useViewActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const [stats, setStats] = useState<Office3Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const connect = useLiveAgents((s) => s.connect);
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

  useEffect(() => {
    let cancelled = false;
    let h: Office3Handle | null = null;
    let unbind: (() => void) | null = null;
    (async () => {
      try {
        const { startOffice3 } = await import("@/office3/office3");
        if (cancelled || !host.current) return;
        h = await startOffice3(host.current);
        if (cancelled) { h.destroy(); return; }
        handle.current = h;
        if (!activeRef.current) h.setActive(false);
        h.sync(peopleRef.current);
        unbind = bindLive({ applyLive: (l) => h?.applyLive(l) });
      } catch (e) { console.error("office3 init failed", e); setErr(String(e)); }
    })();
    const t = setInterval(() => { if (handle.current) setStats(handle.current.stats()); }, 1000);
    return () => { cancelled = true; clearInterval(t); unbind?.(); h?.destroy(); handle.current = null; };
  }, []);

  useEffect(() => { handle.current?.sync(peopleRef.current); }, [sig]);
  useEffect(() => { handle.current?.setActive(active); }, [active]);

  return (
    <div className="relative h-full min-h-[560px] w-full">
      <div ref={host} data-testid="office3-host" className="absolute inset-0" />
      <div className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-2 text-xs ring-1 ring-white/15" data-testid="office3-hud">
        <div className="font-semibold">Office 3 (beta, 3D)</div>
        {stats && <div className="opacity-80">{stats.fps} fps · {stats.people} people · {stats.calls} draw calls · {(stats.triangles / 1000).toFixed(0)}k tris</div>}
        <div className="opacity-50">drag = pan · right-drag = rotate · wheel = zoom</div>
        {err && <div className="text-red-300">{err}</div>}
      </div>
    </div>
  );
}
