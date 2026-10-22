"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/swr";
import { useViewActive } from "@/lib/viewActive";
import { hashParams } from "@/office2/constants";
import { makeSimPeople, peopleSignature, toPeople, type DirectoryLike, type RosterLike } from "@/office2/people";
import { bindLive } from "@/office2/liveBridge";
import type { Office3Handle, Office3Stats } from "@/office3/office3";
import { useLiveAgents } from "@/stores/liveAgentsStore";
import { ViewSettings, type ViewSettings as OfficeViewSettings } from "@/office3/ui/ViewSettings";
import { Minimap3D } from "@/office3/ui/Minimap3D";
import { LookGallery } from "@/office3/ui/LookGallery";
import { CustomModelImport } from "@/office3/ui/CustomModelImport";
import { HelpOverlay } from "@/office3/ui/HelpOverlay";
import { CommandPalette } from "@/office3/ui/CommandPalette";
import { ActionBar } from "@/office3/ui/ActionBar";
import { Roster } from "@/office3/ui/Roster";
import { BuilderPanel } from "@/office3/ui/BuilderPanel";
import { TaskBoard } from "@/office3/ui/TaskBoard";
import { AttentionInbox } from "@/office3/ui/AttentionInbox";
import { VisitCard, type VisitPerson } from "@/office3/ui/VisitCard";
import { Onboarding } from "@/office3/ui/Onboarding";
import { ActivityFeed } from "@/office3/ui/ActivityFeed";
import { SelectionBar } from "@/office3/ui/SelectionBar";
import { AppearanceEditor } from "@/office3/ui/AppearanceEditor";
import { ThemePicker } from "@/office3/ui/ThemePicker";
import { ZoneOverlayToggle } from "@/office3/ui/ZoneOverlayToggle";
import { MinutesDrawer } from "@/office3/ui/MinutesDrawer";
import { AgentThreadsDrawer } from "@/office3/ui/AgentThreadsDrawer";
import { ConversationDrawer } from "@/office3/ui/ConversationDrawer";
import { Toasts } from "@/office3/ui/Toasts";
import { parseAppearance, type Appearance } from "@/office3/core/appearance";
import type { World } from "@/office3/core/world";

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
  const [rosterOpen, setRosterOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [visitPerson, setVisitPerson] = useState<VisitPerson | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const [minutesOpen, setMinutesOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [conversationMembers, setConversationMembers] = useState<{ slug: string; name: string; kind: "human" | "agent" }[] | null>(null);
  const [backendOnline, setBackendOnline] = useState(true);
  const [webglLost, setWebglLost] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewSettings, setViewSettings] = useState<OfficeViewSettings | null>(null);
  const viewSettingsRef = useRef<OfficeViewSettings | null>(null);
  viewSettingsRef.current = viewSettings;

  const connect = useLiveAgents((s) => s.connect);
  useEffect(() => connect(WS_URL), [connect]);
  useEffect(() => { const onCard = (event: Event) => setVisitPerson((event as CustomEvent<VisitPerson>).detail); window.addEventListener("office3:visit-card", onCard); return () => window.removeEventListener("office3:visit-card", onCard); }, []);
  useEffect(() => { const onSelection = (event: Event) => setSelectionCount((event as CustomEvent<number>).detail); window.addEventListener("office3:selection", onSelection); return () => window.removeEventListener("office3:selection", onSelection); }, []);
  useEffect(() => { const onInteraction = (event: Event) => { if ((event as CustomEvent<string>).detail === "whiteboard") setTasksOpen(true); }; window.addEventListener("office3:interaction", onInteraction); return () => window.removeEventListener("office3:interaction", onInteraction); }, []);
  useEffect(() => { const onAttention = () => { setAttentionOpen(true); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { id: "attention", text: "An agent needs your approval.", priority: "warning" } })); }; window.addEventListener("office3:attention", onAttention); return () => window.removeEventListener("office3:attention", onAttention); }, []);
  useEffect(() => { const onResolved = (event: Event) => { const detail = (event as CustomEvent<{ agent?: string; approved: boolean }>).detail; if (detail.agent) handle.current?.resolveAttention(detail.agent, detail.approved); }; window.addEventListener("office3:approval-resolved", onResolved); return () => window.removeEventListener("office3:approval-resolved", onResolved); }, []);
  useEffect(() => { const open = (event: Event) => setConversationMembers((event as CustomEvent<{ slug: string; name: string; kind: "human" | "agent" }[]>).detail); const group = (event: Event) => { const members = (event as CustomEvent<{ slug: string; name: string; kind: "human" | "agent" }[]>).detail; if (members?.length > 1) setConversationMembers(current => current ?? members); }; window.addEventListener("office3:open-conversation", open); window.addEventListener("office3:conversation-group", group); return () => { window.removeEventListener("office3:open-conversation", open); window.removeEventListener("office3:conversation-group", group); }; }, []);
  useEffect(() => { const check = () => fetch(`${API}/health`).then(response => setBackendOnline(response.ok)).catch(() => setBackendOnline(false)); check(); const timer = window.setInterval(check, 15000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const lost = () => setWebglLost(true); const restored = () => setWebglLost(false); window.addEventListener("office3:webgl-lost", lost); window.addEventListener("office3:webgl-restored", restored); return () => { window.removeEventListener("office3:webgl-lost", lost); window.removeEventListener("office3:webgl-restored", restored); }; }, []);
  useEffect(() => { const toggle = (event: KeyboardEvent) => { if (event.key === "Escape") { setSettingsOpen(false); return; } if (event.key.toLowerCase() !== "v" || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return; event.preventDefault(); setSettingsOpen(open => !open); }; window.addEventListener("keydown", toggle); return () => window.removeEventListener("keydown", toggle); }, []);
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
        if (viewSettingsRef.current) h.setViewSettings(viewSettingsRef.current);
        try {
          const saved = localStorage.getItem("office3.appearance");
          if (saved) h.setFounderAppearance(parseAppearance(JSON.parse(saved)));
        } catch { localStorage.removeItem("office3.appearance"); }
        const customModel = localStorage.getItem("office3.customModel");
        if (customModel) h.setFounderCustomModel(customModel);
        unbind = bindLive({ applyLive: (l) => h?.applyLive(l) });
      } catch (e) { console.error("office3 init failed", e); setErr(String(e)); }
    })();
    const t = setInterval(() => { if (handle.current) setStats(handle.current.stats()); }, 1000);
    return () => { cancelled = true; clearInterval(t); unbind?.(); h?.destroy(); handle.current = null; };
  }, []);

  useEffect(() => { handle.current?.sync(peopleRef.current); }, [sig]);
  useEffect(() => { handle.current?.setActive(active); }, [active]);
  useEffect(() => { if (viewSettings) handle.current?.setViewSettings(viewSettings); }, [viewSettings]);
  useEffect(() => {
    const founder = people.find((person) => person.kind === "human");
    if (!founder) return;
    let cancelled = false;
    fetch(`${API}/api/v1/office/appearance/${encodeURIComponent(founder.slug)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((saved) => { if (!cancelled && saved) handle.current?.setFounderAppearance(parseAppearance(saved)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [people, sig]);

  const applyFounderAppearance = (appearance: Appearance) => {
    handle.current?.setFounderAppearance(appearance);
    const founder = peopleRef.current.find((person) => person.kind === "human");
    if (!founder) return;
    fetch(`${API}/api/v1/office/appearance/${encodeURIComponent(founder.slug)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appearance }),
    }).catch((error) => console.warn("Office appearance persistence failed", error));
  };
  const applyTheme = async (id: string) => {
    handle.current?.setTheme(id);
    try {
      const currentResponse = await fetch(`${API}/api/v1/office/world`);
      if (!currentResponse.ok) throw Error("Unable to load Office world");
      const current = await currentResponse.json();
      const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: { ...current.world, theme: id }, rev: current.rev }) });
      if (!response.ok) throw Error("Unable to save Office theme");
    } catch (error) { console.warn("Office theme persistence failed", error); }
  };
  const updateRoomRules = async (roomId: string, rules: { silent: boolean; focusable: boolean; capacity: number; tooltip?: string; roles?: Array<"founder" | "member">; locked?: boolean; ambience?: "none" | "focus" | "social" | "meeting" }) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load Office world");
    const current = await currentResponse.json();
    const rooms = current.world.rooms.map((room: { id: string; rules: object }) => room.id === roomId ? { ...room, rules: { ...room.rules, ...rules } } : room);
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: { ...current.world, rooms }, rev: current.rev }) });
    if (!response.ok) throw Error("Unable to save zone rules");
  };
  const claimFounderDesk = async (seatId: string) => {
    const founder = peopleRef.current.find(person => person.kind === "human");
    if (!founder) throw Error("Founder is unavailable");
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load Office world");
    const current = await currentResponse.json();
    const seat = current.world.seats.find((item: { id: string; owner: string | null }) => item.id === seatId);
    if (!seat || seat.owner || current.world.seats.some((item: { owner: string | null }) => item.owner === founder.slug)) throw Error("Desk is unavailable");
    const seats = current.world.seats.map((item: { id: string; owner: string | null }) => item.id === seatId ? { ...item, owner: founder.slug } : item);
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: { ...current.world, seats }, rev: current.rev }) });
    if (!response.ok) throw Error("Unable to claim desk");
  };
  const setSpawnFromRoom = async (roomId: string) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load Office world");
    const current = await currentResponse.json();
    const room = current.world.rooms.find((item: { id: string; rect: [number, number, number, number] }) => item.id === roomId);
    if (!room) throw Error("Room is unavailable");
    const [left, top, right, bottom] = room.rect;
    const position: [number, number] = [Math.floor((left + right) / 2), Math.floor((top + bottom) / 2)];
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: { ...current.world, spawn: { founder: position, default: position } }, rev: current.rev }) });
    if (!response.ok) throw Error("Unable to save spawn point");
  };
  const publishBuilderDraft = async (force = false) => {
    const draft = JSON.parse(localStorage.getItem("office3.builder.draft") ?? "{\"objects\":[]}") as { objects?: { key: string; prefab: string }[]; seats?: unknown[] };
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load the current Office world");
    const current = await currentResponse.json();
    const objects = (draft.objects ?? []).flatMap((item, index) => { const [x, z] = item.key.split(",").map(Number); return Number.isFinite(x) && Number.isFinite(z) ? [{ id: `draft-${Date.now()}-${index}`, prefab: item.prefab, pos: [x, z], rot: 0, scale: 1, props: {} }] : []; });
    const seats = (draft.seats ?? []).filter((seat): seat is { id: string; room: string; pos: [number, number]; facing: "up"|"down"|"left"|"right"; owner: null } => Boolean(seat && typeof seat === "object" && "id" in seat && "room" in seat && "pos" in seat && "facing" in seat));
    const publish = async (base: { world: { objects: unknown[]; seats: { room: string; pos: [number, number] }[] }; rev: number }) => fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world: { ...base.world, objects: [...base.world.objects, ...objects], seats: [...base.world.seats, ...seats.filter(seat => !base.world.seats.some(existing => existing.room === seat.room && existing.pos[0] === seat.pos[0] && existing.pos[1] === seat.pos[1]))] }, rev: base.rev }) });
    let response = await publish(current);
    if (response.status === 409 && force) { const latestResponse = await fetch(`${API}/api/v1/office/world`); if (!latestResponse.ok) throw Error("WORLD_CONFLICT"); response = await publish(await latestResponse.json()); }
    if (response.status === 409) throw Error("WORLD_CONFLICT");
    if (!response.ok) throw Error("Unable to publish Office draft");
    localStorage.removeItem("office3.builder.draft");
  };
  const importBuilderWorld = async (world: World) => {
    const currentResponse = await fetch(`${API}/api/v1/office/world`);
    if (!currentResponse.ok) throw Error("Unable to load the current Office world");
    const current = await currentResponse.json();
    const response = await fetch(`${API}/api/v1/office/world`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ world, rev: current.rev }) });
    if (response.status === 409) throw Error("WORLD_CONFLICT");
    if (!response.ok) throw Error("Unable to import Office world");
  };

  return (
    <div className="relative h-full min-h-[560px] w-full">
      <div ref={host} data-testid="office3-host" className="absolute inset-0" />
      <Toasts />
      {!backendOnline && <div className="absolute left-1/2 top-3 z-50 -translate-x-1/2 rounded-lg bg-amber-900/95 px-3 py-2 text-xs text-amber-100 shadow-lg">Office is offline. Local scene controls remain available; saved changes will retry when the backend returns.</div>}
      {webglLost && <div className="absolute inset-0 z-50 grid place-items-center bg-slate-950/95 p-6 text-center text-white"><div><h2 className="text-lg font-semibold">Office 3 graphics paused</h2><p className="mt-2 text-sm text-slate-300">WebGL was lost by the graphics driver. You can retry the Office or use Office 2.</p><div className="mt-4 flex justify-center gap-2"><button className="rounded bg-blue-700 px-3 py-2 text-sm" onClick={() => location.reload()}>Retry Office 3</button><button className="rounded bg-slate-700 px-3 py-2 text-sm" onClick={() => { location.hash = "office2"; }}>Open Office 2</button></div></div></div>}
      <ViewSettings onChange={setViewSettings} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Minimap3D />
      <LookGallery onSelect={applyFounderAppearance} />
      <AppearanceEditor onApply={applyFounderAppearance} />
      <ThemePicker onChange={applyTheme} />
      <ZoneOverlayToggle onChange={(visible) => handle.current?.setZoneOverlay(visible)} />
      <CustomModelImport onImported={url => handle.current?.setFounderCustomModel(url)} />
      <HelpOverlay />
      <CommandPalette people={people} onGo={(slug) => handle.current?.focusPerson(slug)} />
      <ActionBar onRoster={() => setRosterOpen(true)} onAppearance={() => document.querySelector<HTMLDetailsElement>("details")?.setAttribute("open", "")} onChat={() => { location.hash = "team_chat"; }} onEdit={() => { handle.current?.setEditMode(true); setBuilderOpen(true); }} onTasks={() => setTasksOpen(true)} onAttention={() => setAttentionOpen(true)} onActivity={() => setActivityOpen(true)} onMinutes={() => setMinutesOpen(true)} onThreads={() => setThreadsOpen(true)} onSettings={() => setSettingsOpen(true)} />
      {rosterOpen && <Roster people={people} onClose={() => setRosterOpen(false)} onGo={(slug) => { handle.current?.focusPerson(slug); setRosterOpen(false); }} />}
      {builderOpen && <BuilderPanel onSelect={(id) => handle.current?.setBuilderPrefab(id)} onTemplate={(room, template) => handle.current?.insertRoomTemplate(room, template)} onAutoFurnish={room => handle.current?.autoFurnishRoom(room)} onApplyRoomRules={updateRoomRules} onClaimDesk={claimFounderDesk} onSetSpawn={setSpawnFromRoom} onSaveDraft={() => handle.current?.saveBuilderDraft()} onSnapshot={async () => { const response = await fetch(`${API}/api/v1/office/snapshots`, { method: "POST" }); if (!response.ok) throw Error("Unable to save snapshot"); }} onRestoreSnapshot={async id => { const response = await fetch(`${API}/api/v1/office/snapshots/${id}/restore`, { method: "POST" }); if (!response.ok) throw Error("Unable to restore snapshot"); }} onPublish={publishBuilderDraft} onImportWorld={importBuilderWorld} onLockRoom={async room => { const response = await fetch(`${API}/api/v1/office/rooms/${encodeURIComponent(room)}/lock`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ editor: "founder" }) }); if (!response.ok) throw Error("Unable to reserve room"); }} onUnlockRoom={async room => { await fetch(`${API}/api/v1/office/rooms/${encodeURIComponent(room)}/lock?editor=founder`, { method: "DELETE" }); }} onClose={() => { handle.current?.setEditMode(false); setBuilderOpen(false); }} />}
      {tasksOpen && <TaskBoard onClose={() => setTasksOpen(false)} />}
      {attentionOpen && <AttentionInbox onClose={() => setAttentionOpen(false)} />}
      {visitPerson && <VisitCard person={visitPerson} onClose={() => setVisitPerson(null)} />}
      {activityOpen && <ActivityFeed onClose={() => setActivityOpen(false)} />}
      {minutesOpen && <MinutesDrawer onClose={() => setMinutesOpen(false)} />}
      {threadsOpen && <AgentThreadsDrawer onClose={() => setThreadsOpen(false)} onFocus={slug => { handle.current?.focusPerson(slug); setThreadsOpen(false); }} />}
      {conversationMembers && <ConversationDrawer members={conversationMembers} onClose={() => setConversationMembers(null)} />}
      <SelectionBar count={selectionCount} onClear={() => window.dispatchEvent(new Event("office3:clear-selection"))} />
      <Onboarding />
      <div className="absolute left-3 top-3 rounded-lg bg-black/60 px-3 py-2 text-xs ring-1 ring-white/15" data-testid="office3-hud">
        <div className="font-semibold">Office 3 (beta, 3D)</div>
        {stats && viewSettings?.fps && <div className="opacity-80">{stats.fps} fps · {stats.people} people · {stats.calls} draw calls · {(stats.triangles / 1000).toFixed(0)}k tris</div>}
        <div className="opacity-50">drag = pan · right-drag = rotate · wheel = zoom</div>
        {err && <div className="text-red-300">{err}</div>}
      </div>
    </div>
  );
}
