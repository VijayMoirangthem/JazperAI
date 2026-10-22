"use client";

import { useEffect, useMemo, useState } from "react";
import { exportWorld, importWorld } from "../core/worldTransfer";
import type { World } from "../core/world";

interface Prefab { id: string; name: string; category: string; }
interface Room { id: string; label: string; rect: [number, number, number, number]; rules?: { silent?: boolean; focusable?: boolean; capacity?: number; tooltip?: string; roles?: Array<"founder" | "member">; locked?: boolean; ambience?: "none" | "focus" | "social" | "meeting" }; }
interface Seat { id: string; room: string; pos: [number, number]; owner: string | null; }
interface Lock { room_id: string; editor: string; }
interface WorldOption { id: string; rev: number; active: boolean; }
interface Conflict { rev: number; objects: number; seats: number; draftObjects: number; draftSeats: number; }

interface BuilderPanelProps {
  onClose(): void;
  onSelect(id: string): void;
  onTemplate(room: string, template: "meeting-8" | "lounge" | "open-desks" | "server-room" | "kitchenette" | "phone-booth"): void;
  onAutoFurnish(room: string): void;
  onApplyRoomRules(room: string, rules: { silent: boolean; focusable: boolean; capacity: number; tooltip?: string; roles?: Array<"founder" | "member">; locked?: boolean; ambience?: "none" | "focus" | "social" | "meeting" }): Promise<void>;
  onClaimDesk(seat: string): Promise<void>;
  onSetSpawn(room: string): Promise<void>;
  onSaveDraft(): void;
  onPublish(force?: boolean): Promise<void>;
  onSnapshot(): Promise<void>;
  onRestoreSnapshot(id: number): Promise<void>;
  onLockRoom(room: string): Promise<void>;
  onUnlockRoom(room: string): Promise<void>;
  onImportWorld(world: World): Promise<void>;
}

const apiUrl = () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function BuilderPanel(props: BuilderPanelProps) {
  const [saving, setSaving] = useState(false);
  const [catalogue, setCatalogue] = useState<Prefab[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [locks, setLocks] = useState<Lock[]>([]);
  const [activeLock, setActiveLock] = useState<string | null>(null);
  const [templateRoom, setTemplateRoom] = useState<string | null>(null);
  const [zoneRoom, setZoneRoom] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<{ id: number; rev: number; created_at: string }[]>([]);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  useEffect(() => {
    fetch("/office3/catalog.json").then(response => response.json()).then(setCatalogue).catch(() => setCatalogue([]));
  }, []);
  useEffect(() => {
    fetch(`${apiUrl()}/api/v1/office/world`).then(response => response.json()).then(value => {
      setRooms(value.world?.rooms ?? []);
      setSeats(value.world?.seats ?? []);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    let stopped = false;
    const refresh = () => fetch(`${apiUrl()}/api/v1/office/room-locks`)
      .then(response => response.ok ? response.json() : null)
      .then(value => { if (!stopped && value) setLocks(value.locks ?? []); })
      .catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    fetch(`${apiUrl()}/api/v1/office/snapshots`).then(response => response.json()).then(value => setSnapshots(value.snapshots ?? [])).catch(() => undefined);
    fetch(`${apiUrl()}/api/v1/office/worlds`).then(response => response.ok ? response.json() : null).then(value => { if (value) setWorlds(value.worlds ?? []); }).catch(() => undefined);
  }, []);

  const visible = useMemo(() => catalogue.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase())), [catalogue, query]);
  const currentRules = rooms.find(room => room.id === zoneRoom)?.rules ?? {};

  const exportCurrentWorld = async () => {
    const response = await fetch(`${apiUrl()}/api/v1/office/world`);
    if (!response.ok) throw Error("export unavailable");
    const value = await response.json();
    const blob = new Blob([exportWorld(value.world)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${value.world.id || "office3-world"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      await props.onImportWorld(importWorld(await file.text()));
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Validated world imported. Reload Office to view it.", priority: "success" } }));
    } catch (reason) {
      setError(reason instanceof Error ? `Import failed: ${reason.message}` : "Import failed.");
    }
  };
  const activateWorld = async (id: string) => {
    const response = await fetch(`${apiUrl()}/api/v1/office/worlds/${encodeURIComponent(id)}/activate`, { method: "POST" });
    if (!response.ok) throw Error("switch failed");
    setWorlds(current => current.map(world => ({ ...world, active: world.id === id })));
    window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Active world switched. Reload Office to view it.", priority: "success" } }));
  };
  const cloneActiveWorld = async () => {
    const id = window.prompt("New world ID (letters, numbers, _ or -)");
    if (!id) return;
    const name = window.prompt("New world name", id);
    if (!name) return;
    const response = await fetch(`${apiUrl()}/api/v1/office/worlds/clone`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name }) });
    if (!response.ok) throw Error("clone failed");
    const value = await response.json();
    setWorlds(current => [...current, { id: value.world.id, rev: value.rev, active: false }]);
    window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "World cloned. Select it to make it active.", priority: "success" } }));
  };
  const publish = async (force = false) => {
    setSaving(true);
    setError(null);
    if (!force) setConflict(null);
    try {
      await props.onPublish(force);
      setConflict(null);
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: force ? "Draft merged into the latest world." : "Office world published.", priority: "success" } }));
    } catch (reason) {
      if (reason instanceof Error && reason.message === "WORLD_CONFLICT" && !force) {
        try {
          const latest = await fetch(`${apiUrl()}/api/v1/office/world`).then(response => response.json());
          const draft = JSON.parse(localStorage.getItem("office3.builder.draft") ?? "{\"objects\":[],\"seats\":[]}") as { objects?: unknown[]; seats?: unknown[] };
          setConflict({ rev: Number(latest.rev), objects: latest.world?.objects?.length ?? 0, seats: latest.world?.seats?.length ?? 0, draftObjects: draft.objects?.length ?? 0, draftSeats: draft.seats?.length ?? 0 });
        } catch { setError("The world changed elsewhere; reload before publishing again."); }
      } else setError(force ? "Merge publish failed; your draft remains saved." : "Publish failed. Your local draft is preserved.");
    } finally { setSaving(false); }
  };
  const applyRules = async (next: Partial<NonNullable<Room["rules"]>>) => {
    if (!zoneRoom) return;
    const rules = { silent: currentRules.silent ?? false, focusable: currentRules.focusable ?? false, capacity: currentRules.capacity ?? 0, tooltip: currentRules.tooltip ?? "", roles: currentRules.roles ?? [], locked: currentRules.locked ?? false, ambience: currentRules.ambience ?? "none", ...next };
    try {
      await props.onApplyRoomRules(zoneRoom, rules);
      setRooms(current => current.map(room => room.id === zoneRoom ? { ...room, rules } : room));
    } catch { setError("Unable to save zone rules."); }
  };
  const reserveRoom = async (room: string) => {
    if (activeLock) await props.onUnlockRoom(activeLock);
    if (!room) { setActiveLock(null); return; }
    try {
      await props.onLockRoom(room);
      setActiveLock(room);
      setLocks(current => [...current.filter(lock => lock.room_id !== room), { room_id: room, editor: "founder" }]);
    } catch { setError("That room is currently reserved by another editor."); }
  };
  const setSpawn = async () => {
    if (!zoneRoom) return;
    try {
      await props.onSetSpawn(zoneRoom);
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Spawn point saved. Reload Office to apply it.", priority: "success" } }));
    } catch { setError("Unable to save the spawn point."); }
  };

  return <aside className="absolute right-3 top-14 z-30 max-h-[calc(100%-5rem)] w-72 overflow-auto rounded-xl bg-slate-950/95 p-3 text-white shadow-2xl ring-1 ring-white/15">
    <button className="float-right text-xs opacity-70" onClick={() => { if (activeLock) void props.onUnlockRoom(activeLock); props.onClose(); }}>Exit edit</button>
    <button className="mr-3 float-right rounded bg-emerald-700 px-2 py-1 text-xs" disabled={saving} onClick={() => void publish()}>{saving ? "Publishing…" : "Publish"}</button>
    <button className="mr-3 float-right rounded bg-slate-700 px-2 py-1 text-xs" onClick={() => { void props.onSnapshot().then(() => setError("Snapshot saved.")).catch(() => setError("Snapshot could not be saved.")); }}>Snapshot</button>
    <button className="mr-3 float-right rounded bg-blue-700 px-2 py-1 text-xs" onClick={props.onSaveDraft}>Save draft</button>
    <h2 className="mb-2 text-sm font-semibold">World builder</h2>
    {error && <p className="mb-2 rounded bg-rose-950 p-2 text-[11px] text-rose-200">{error}</p>}
    <div className="mb-2 flex gap-1 text-[11px]">
      <button className="rounded bg-slate-800 px-2 py-1" onClick={() => void exportCurrentWorld().catch(() => setError("Export failed."))}>Export JSON</button>
      <label className="cursor-pointer rounded bg-slate-800 px-2 py-1">Import JSON<input className="hidden" type="file" accept="application/json,.json" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
    </div>
    <div className="mb-2 rounded bg-slate-900 p-2 text-[11px]">
      <label className="block opacity-70">Active world</label>
      <select className="mt-1 w-full rounded bg-slate-800 p-1" value={worlds.find(world => world.active)?.id ?? ""} onChange={event => { if (event.target.value) void activateWorld(event.target.value).catch(() => setError("World switch failed.")); }}>
        <option value="" disabled>Choose world</option>
        {worlds.map(world => <option key={world.id} value={world.id}>{world.id} · rev {world.rev}{world.active ? " (active)" : ""}</option>)}
      </select>
      <button className="mt-1 rounded bg-slate-800 px-2 py-1" onClick={() => void cloneActiveWorld().catch(() => setError("World clone failed. Use a unique safe ID."))}>Clone active world</button>
    </div>
    {conflict && <div className="mb-2 rounded bg-amber-950 p-2 text-[11px] text-amber-100">
      <strong>World changed (revision {conflict.rev})</strong>
      <p className="mt-1">Remote: {conflict.objects} objects, {conflict.seats} seats. Your preserved draft adds: {conflict.draftObjects} objects, {conflict.draftSeats} seats.</p>
      <div className="mt-2 flex gap-1"><button className="rounded bg-slate-700 px-2 py-1" onClick={() => location.reload()}>Reload theirs</button><button className="rounded bg-amber-700 px-2 py-1" onClick={() => void publish(true)}>Publish my additions</button></div>
    </div>}
    <div className="mb-2 rounded bg-slate-900 p-2 text-[11px]">
      <label className="block opacity-70">Room reservation</label>
      <select className="mt-1 w-full rounded bg-slate-800 p-1" value={activeLock ?? ""} onChange={event => void reserveRoom(event.target.value)}>
        <option value="">No room reserved</option>
        {rooms.map(room => { const lock = locks.find(item => item.room_id === room.id); return <option key={room.id} value={room.id} disabled={Boolean(lock && lock.editor !== "founder")}>{room.label}{lock && lock.editor !== "founder" ? ` (${lock.editor})` : ""}</option>; })}
      </select>
    </div>
    <div className="mb-2 rounded bg-slate-900 p-2 text-[11px]">
      <label className="block opacity-70">Room templates</label>
      <select className="mt-1 w-full rounded bg-slate-800 p-1" value={templateRoom ?? ""} onChange={event => setTemplateRoom(event.target.value || null)}><option value="">Choose a room</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.label}</option>)}</select>
      <div className="mt-1 grid grid-cols-2 gap-1">{([ ["meeting-8", "Meeting 8"], ["open-desks", "Open desks"], ["lounge", "Lounge"], ["server-room", "Server room"], ["kitchenette", "Kitchenette"], ["phone-booth", "Phone booth"] ] as const).map(([id, label]) => <button key={id} disabled={!templateRoom} className="rounded bg-slate-800 p-1 disabled:opacity-40" onClick={() => templateRoom && props.onTemplate(templateRoom, id)}>{label}</button>)}</div>
      <button disabled={!templateRoom} className="mt-1 w-full rounded bg-indigo-700 p-1 disabled:opacity-40" onClick={() => templateRoom && props.onAutoFurnish(templateRoom)}>Auto-furnish room</button>
    </div>
    <div className="mb-2 rounded bg-slate-900 p-2 text-[11px]">
      <label className="block opacity-70">Zone authoring</label>
      <select className="mt-1 w-full rounded bg-slate-800 p-1" value={zoneRoom ?? ""} onChange={event => setZoneRoom(event.target.value || null)}><option value="">Choose a room</option>{rooms.map(room => <option key={room.id} value={room.id}>{room.label}</option>)}</select>
      {zoneRoom && <div className="mt-1 space-y-1"><label className="flex items-center gap-1"><input type="checkbox" checked={currentRules.silent ?? false} onChange={event => void applyRules({ silent: event.target.checked })} /> Silent zone</label><label className="flex items-center gap-1"><input type="checkbox" checked={currentRules.focusable ?? false} onChange={event => void applyRules({ focusable: event.target.checked })} /> Focusable</label><label className="flex items-center gap-1"><input type="checkbox" checked={currentRules.locked ?? false} onChange={event => void applyRules({ locked: event.target.checked })} /> Locked</label><label className="block">Capacity<input className="ml-1 w-12 rounded bg-slate-800 p-1" type="number" min="0" value={currentRules.capacity ?? 0} onChange={event => void applyRules({ capacity: Math.max(0, Number(event.target.value) || 0) })} /></label><label className="block">Access<select className="ml-1 rounded bg-slate-800 p-1" value={(currentRules.roles ?? []).join(",")} onChange={event => void applyRules({ roles: event.target.value ? event.target.value.split(",") as Array<"founder" | "member"> : [] })}><option value="">Everyone</option><option value="founder">Founder only</option><option value="member">Members only</option><option value="founder,member">Founder and members</option></select></label><label className="block">Ambience<select className="ml-1 rounded bg-slate-800 p-1" value={currentRules.ambience ?? "none"} onChange={event => void applyRules({ ambience: event.target.value as "none" | "focus" | "social" | "meeting" })}><option value="none">None</option><option value="focus">Focus</option><option value="social">Social</option><option value="meeting">Meeting</option></select></label><label className="block">Entry note<input className="ml-1 w-full rounded bg-slate-800 p-1" maxLength={120} value={currentRules.tooltip ?? ""} placeholder="Shown on entry" onChange={event => void applyRules({ tooltip: event.target.value })} /></label><button className="w-full rounded bg-slate-800 p-1 text-left hover:bg-slate-700" onClick={() => void setSpawn()}>Set founder/default spawn here</button></div>}
    </div>
    <div className="mb-2 rounded bg-slate-900 p-2 text-[11px]"><label className="block opacity-70">Personal desk</label>{seats.filter(seat => !seat.owner).slice(0, 8).map(seat => <button key={seat.id} className="mt-1 block w-full rounded bg-slate-800 p-1 text-left hover:bg-slate-700" onClick={() => { void props.onClaimDesk(seat.id).then(() => { setSeats(current => current.map(item => item.id === seat.id ? { ...item, owner: "founder" } : item)); setError("Desk claimed. It will be your default seat after reload."); }).catch(() => setError("This desk is no longer available.")); }}>Claim {seat.room} desk ({seat.pos[0]}, {seat.pos[1]})</button>)}</div>
    {snapshots.length > 0 && <details className="mb-2 text-[11px]"><summary>Version history ({snapshots.length})</summary>{snapshots.slice(0, 5).map(snapshot => <button key={snapshot.id} className="mt-1 block w-full rounded bg-slate-800 p-1 text-left hover:bg-slate-700" onClick={() => { void props.onRestoreSnapshot(snapshot.id).then(() => setError("Snapshot restored. Reload Office to view it.")).catch(() => setError("Snapshot restore failed.")); }}>Restore rev {snapshot.rev}</button>)}</details>}
    <p className="mb-2 text-[11px] opacity-70">Select an object, then click the grid to place. Click a placed object to select; R rotates and Del erases. Ctrl+Z/Y undo/redo.</p>
    <input className="mb-2 w-full rounded bg-slate-800 p-2 text-xs" value={query} placeholder="Find a prefab…" onChange={event => setQuery(event.target.value)} />
    <div className="grid grid-cols-2 gap-1">{visible.map(item => <button key={item.id} onClick={() => { setSelected(item.id); props.onSelect(item.id); }} className={`rounded p-2 text-left text-[11px] ${selected === item.id ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}><span className="block truncate">{item.name}</span><span className="opacity-50">{item.category}</span></button>)}</div>
  </aside>;
}
