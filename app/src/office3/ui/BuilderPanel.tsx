"use client";

import { useEffect, useMemo, useState } from "react";
import { exportWorld, importWorld } from "../core/worldTransfer";
import { describeDiff, diffObjects } from "../core/worldDiff";
import { officePersonAuthHeaders } from "../core/auth";
import type { World } from "../core/world";

interface Prefab { id: string; name: string; category: string; }
interface Room { id: string; label: string; rect: [number, number, number, number]; rules?: { silent?: boolean; focusable?: boolean; capacity?: number; tooltip?: string; roles?: Array<"founder" | "member">; locked?: boolean; ambience?: "none" | "focus" | "social" | "meeting" }; }
interface Seat { id: string; room: string; pos: [number, number]; owner: string | null; }
interface WorldObject { id: string; prefab: string; pos: [number, number]; rot: number; scale: number; }
interface Lock { room_id: string; editor: string; }
interface WorldOption { id: string; rev: number; active: boolean; }
interface Conflict { rev: number; objects: number; seats: number; draftObjects: { prefab: string; key: string; rot?: number }[]; draftSeats: string[]; tileCollisions: { draft: { prefab: string; key: string; rot?: number }; remote: WorldObject }[]; }

interface BuilderPanelProps {
  initialObjectId?: string | null;
  onClose(): void;
  onSelect(id: string): void;
  onTemplate(room: string, template: "meeting-8" | "lounge" | "open-desks" | "server-room" | "kitchenette" | "phone-booth"): void;
  onAutoFurnish(room: string): void;
  onApplyRoomRules(room: string, rules: { silent: boolean; focusable: boolean; capacity: number; tooltip?: string; roles?: Array<"founder" | "member">; locked?: boolean; ambience?: "none" | "focus" | "social" | "meeting" }): Promise<void>;
  onResizeRoom(room: string, rect: [number, number, number, number]): Promise<void>;
  onClaimDesk(seat: string): Promise<void>;
  onSetSpawn(room: string): Promise<void>;
  onUpdateObject(id: string, patch: Partial<Pick<WorldObject, "pos" | "rot" | "scale">>): Promise<void>;
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
  const [objects, setObjects] = useState<WorldObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [explorerQuery, setExplorerQuery] = useState("");
  const [locks, setLocks] = useState<Lock[]>([]);
  const [activeLock, setActiveLock] = useState<string | null>(null);
  const [templateRoom, setTemplateRoom] = useState<string | null>(null);
  const [zoneRoom, setZoneRoom] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<{ id: number; rev: number; created_at: string }[]>([]);
  const [worlds, setWorlds] = useState<WorldOption[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [activeWorldId, setActiveWorldId] = useState("default");
  const [worldSize, setWorldSize] = useState<[number, number] | null>(null);
  const builderDraftStorageKey = `office3.builder.draft.${activeWorldId}`;

  useEffect(() => {
    fetch("/office3/catalog.json").then(response => response.json()).then(setCatalogue).catch(() => setCatalogue([]));
  }, []);
  useEffect(() => {
    fetch(`${apiUrl()}/api/v1/office/world`).then(response => response.json()).then(value => {
      setRooms(value.world?.rooms ?? []);
      setSeats(value.world?.seats ?? []);
      setObjects(value.world?.objects ?? []);
      if (typeof value.world?.id === "string") setActiveWorldId(value.world.id);
      if (Number.isInteger(value.world?.size?.w) && Number.isInteger(value.world?.size?.h)) setWorldSize([value.world.size.w, value.world.size.h]);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    const applyRemotePatch = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: unknown; object?: unknown }>).detail;
      if (typeof detail?.id !== "string" || !detail.object || typeof detail.object !== "object") return;
      setObjects(current => current.map(item => item.id === detail.id ? { ...item, ...detail.object as Partial<WorldObject> } : item));
    };
    window.addEventListener("office3:world-object-patched", applyRemotePatch);
    return () => window.removeEventListener("office3:world-object-patched", applyRemotePatch);
  }, []);
  useEffect(() => {
    if (!props.initialObjectId || !objects.some(object => object.id === props.initialObjectId)) return;
    setSelectedObjectId(props.initialObjectId);
  }, [objects, props.initialObjectId]);
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
    fetch(`${apiUrl()}/api/v1/office/snapshots`, { headers: officePersonAuthHeaders() }).then(response => response.ok ? response.json() : null).then(value => { if (value) setSnapshots(value.snapshots ?? []); }).catch(() => undefined);
    fetch(`${apiUrl()}/api/v1/office/worlds`).then(response => response.ok ? response.json() : null).then(value => { if (value) setWorlds(value.worlds ?? []); }).catch(() => undefined);
  }, []);

  const visible = useMemo(() => catalogue.filter(item => `${item.name} ${item.category}`.toLowerCase().includes(query.toLowerCase())), [catalogue, query]);
  const currentRules = rooms.find(room => room.id === zoneRoom)?.rules ?? {};
  const explorerObjects = useMemo(() => objects.filter(item => `${item.id} ${item.prefab} ${item.pos.join(" ")}`.toLowerCase().includes(explorerQuery.toLowerCase())).slice(0, 30), [objects, explorerQuery]);
  const selectedObject = objects.find(item => item.id === selectedObjectId) ?? null;

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
      const incoming = importWorld(await file.text());
      const before = await fetch(`${apiUrl()}/api/v1/office/world`).then(async response => response.ok ? await response.json() : null).catch(() => null);
      const summary = Array.isArray(before?.world?.objects) ? describeDiff(diffObjects(incoming, before.world)) : "";
      await props.onImportWorld(incoming);
      const current = await fetch(`${apiUrl()}/api/v1/office/world`).then(async response => response.ok ? await response.json() : null);
      if (current?.world) {
        setRooms(current.world.rooms ?? []);
        setSeats(current.world.seats ?? []);
        setObjects(current.world.objects ?? []);
        if (typeof current.world.id === "string") setActiveWorldId(current.world.id);
      }
      setSelectedObjectId(null);
      setConflict(null);
      window.dispatchEvent(new Event("office3:refresh-scene"));
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: summary ? `World imported (objects vs previous: ${summary}).` : "World imported and the 3D scene refreshed.", priority: "success" } }));
    } catch (reason) {
      setError(reason instanceof Error ? `Import failed: ${reason.message}` : "Import failed.");
    }
  };
  const activateWorld = async (id: string) => {
    const response = await fetch(`${apiUrl()}/api/v1/office/worlds/${encodeURIComponent(id)}/activate`, { method: "POST", headers: officePersonAuthHeaders() });
    if (!response.ok) throw Error("switch failed");
    setWorlds(current => current.map(world => ({ ...world, active: world.id === id })));
    const current = await fetch(`${apiUrl()}/api/v1/office/world`).then(async latest => latest.ok ? await latest.json() : null);
    if (current?.world) {
      setRooms(current.world.rooms ?? []);
      setSeats(current.world.seats ?? []);
      setObjects(current.world.objects ?? []);
      if (typeof current.world.id === "string") setActiveWorldId(current.world.id);
      if (Number.isInteger(current.world.size?.w) && Number.isInteger(current.world.size?.h)) setWorldSize([current.world.size.w, current.world.size.h]);
    }
    setSelectedObjectId(null);
    setConflict(null);
    window.dispatchEvent(new Event("office3:refresh-scene"));
    window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Active world switched and the 3D scene refreshed.", priority: "success" } }));
  };
  const cloneActiveWorld = async () => {
    const id = window.prompt("New world ID (letters, numbers, _ or -)");
    if (!id) return;
    const name = window.prompt("New world name", id);
    if (!name) return;
    const response = await fetch(`${apiUrl()}/api/v1/office/worlds/clone`, { method: "POST", headers: { "Content-Type": "application/json", ...officePersonAuthHeaders() }, body: JSON.stringify({ id, name }) });
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
          const draft = JSON.parse(localStorage.getItem(builderDraftStorageKey) ?? "{\"objects\":[],\"seats\":[]}") as { objects?: { prefab?: unknown; key?: unknown; rot?: unknown }[]; seats?: { id?: unknown }[] };
          const draftObjects = (draft.objects ?? []).flatMap(item => typeof item?.prefab === "string" && typeof item.key === "string" ? [{ prefab: item.prefab, key: item.key, ...(typeof item.rot === "number" && Number.isFinite(item.rot) ? { rot: item.rot } : {}) }] : []);
          const draftSeats = (draft.seats ?? []).flatMap(item => typeof item?.id === "string" ? [item.id] : []);
          const remoteObjects: WorldObject[] = Array.isArray(latest.world?.objects) ? latest.world.objects.filter((item: unknown): item is WorldObject => Boolean(item && typeof item === "object" && typeof (item as WorldObject).id === "string" && typeof (item as WorldObject).prefab === "string" && Array.isArray((item as WorldObject).pos))) : [];
          const remoteByTile = new Map(remoteObjects.map(item => [item.pos.join(","), item]));
          const tileCollisions = draftObjects.flatMap(draftObject => { const remote = remoteByTile.get(draftObject.key); return remote ? [{ draft: draftObject, remote }] : []; });
          setConflict({ rev: Number(latest.rev), objects: remoteObjects.length, seats: latest.world?.seats?.length ?? 0, draftObjects, draftSeats, tileCollisions });
        } catch { setError("The world changed elsewhere; reload before publishing again."); }
      } else setError(force ? "Merge publish failed; your draft remains saved." : "Publish failed. Your local draft is preserved.");
    } finally { setSaving(false); }
  };
  const reloadTheirs = async () => {
    const response = await fetch(`${apiUrl()}/api/v1/office/world`);
    if (!response.ok) throw Error("reload failed");
    const value = await response.json();
    setRooms(value.world?.rooms ?? []);
    setSeats(value.world?.seats ?? []);
    setObjects(value.world?.objects ?? []);
    if (typeof value.world?.id === "string") setActiveWorldId(value.world.id);
    if (Number.isInteger(value.world?.size?.w) && Number.isInteger(value.world?.size?.h)) setWorldSize([value.world.size.w, value.world.size.h]);
    setSelectedObjectId(null);
    setConflict(null);
    localStorage.removeItem(builderDraftStorageKey);
    window.dispatchEvent(new Event("office3:refresh-scene"));
    window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Discarded this world's draft and loaded the latest saved world.", priority: "success" } }));
  };
  const restoreSnapshot = async (id: number) => {
    await props.onRestoreSnapshot(id);
    const current = await fetch(`${apiUrl()}/api/v1/office/world`).then(async response => response.ok ? await response.json() : null);
    if (!current?.world) throw Error("restored world unavailable");
    setRooms(current.world.rooms ?? []);
    setSeats(current.world.seats ?? []);
    setObjects(current.world.objects ?? []);
    if (typeof current.world.id === "string") setActiveWorldId(current.world.id);
    if (Number.isInteger(current.world.size?.w) && Number.isInteger(current.world.size?.h)) setWorldSize([current.world.size.w, current.world.size.h]);
    setSelectedObjectId(null);
    setConflict(null);
    localStorage.removeItem(builderDraftStorageKey);
    if (typeof current.world.id === "string" && current.world.id !== activeWorldId) localStorage.removeItem(`office3.builder.draft.${current.world.id}`);
    window.dispatchEvent(new Event("office3:refresh-scene"));
    window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: `Restored revision ${id} and refreshed the 3D scene.`, priority: "success" } }));
  };
  const applyRules = async (next: Partial<NonNullable<Room["rules"]>>) => {
    if (!zoneRoom) return;
    const rules = { silent: currentRules.silent ?? false, focusable: currentRules.focusable ?? false, capacity: currentRules.capacity ?? 0, tooltip: currentRules.tooltip ?? "", roles: currentRules.roles ?? [], locked: currentRules.locked ?? false, ambience: currentRules.ambience ?? "none", ...next };
    try {
      await props.onApplyRoomRules(zoneRoom, rules);
      setRooms(current => current.map(room => room.id === zoneRoom ? { ...room, rules } : room));
    } catch { setError("Unable to save zone rules."); }
  };
  const resizeRoom = async (width: number, height: number) => {
    const room = rooms.find(item => item.id === zoneRoom);
    if (!room || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return;
    const rect: Room["rect"] = [room.rect[0], room.rect[1], room.rect[0] + width - 1, room.rect[1] + height - 1];
    if (worldSize && (rect[2] >= worldSize[0] || rect[3] >= worldSize[1])) { setError("Room bounds must remain inside the active world."); return; }
    try {
      await props.onResizeRoom(room.id, rect);
      setRooms(current => current.map(item => item.id === room.id ? { ...item, rect } : item));
    } catch { setError("Unable to resize room. Check its bounds and overlaps."); }
  };
  const moveRoom = async (x: number, z: number) => {
    const room = rooms.find(item => item.id === zoneRoom);
    if (!room || !Number.isInteger(x) || !Number.isInteger(z) || x < 0 || z < 0) return;
    const width = room.rect[2] - room.rect[0] + 1, height = room.rect[3] - room.rect[1] + 1;
    const rect: Room["rect"] = [x, z, x + width - 1, z + height - 1];
    if (worldSize && (rect[2] >= worldSize[0] || rect[3] >= worldSize[1])) { setError("Room bounds must remain inside the active world."); return; }
    try {
      await props.onResizeRoom(room.id, rect);
      setRooms(current => current.map(item => item.id === room.id ? { ...item, rect } : item));
    } catch { setError("Unable to move room. Check its bounds and overlaps."); }
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
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Spawn point saved and applied.", priority: "success" } }));
    } catch { setError("Unable to save the spawn point."); }
  };
  const updateObject = async (patch: Partial<Pick<WorldObject, "pos" | "rot" | "scale">>) => {
    if (!selectedObject) return;
    if (patch.pos && (!Number.isInteger(patch.pos[0]) || !Number.isInteger(patch.pos[1]) || patch.pos[0] < 0 || patch.pos[1] < 0 || (worldSize && (patch.pos[0] >= worldSize[0] || patch.pos[1] >= worldSize[1])))) { setError("Object position must remain inside the active world."); return; }
    setSaving(true);
    try {
      await props.onUpdateObject(selectedObject.id, patch);
      setObjects(current => current.map(item => item.id === selectedObject.id ? { ...item, ...patch } : item));
      window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Object saved and updated in the scene.", priority: "success" } }));
    } catch { setError("Unable to save object changes."); } finally { setSaving(false); }
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
      <p className="mt-1">Remote: {conflict.objects} objects, {conflict.seats} seats. Your preserved draft adds: {conflict.draftObjects.length} objects, {conflict.draftSeats.length} seats.</p>
      {conflict.tileCollisions.length > 0 && <div className="mt-1 rounded bg-rose-950/70 p-1 text-rose-100"><strong>{conflict.tileCollisions.length} tile collision{conflict.tileCollisions.length === 1 ? "" : "s"}</strong><ul className="mt-1 max-h-16 overflow-auto">{conflict.tileCollisions.slice(0, 8).map(({ draft: draftObject, remote }) => <li key={draftObject.key}>{draftObject.prefab} at {draftObject.key} conflicts with remote {remote.prefab} ({remote.id})</li>)}</ul></div>}
      {conflict.draftObjects.length > 0 && <ul className="mt-1 max-h-20 overflow-auto rounded bg-black/20 p-1 text-[10px]">{conflict.draftObjects.slice(0, 12).map(item => <li key={item.key}>{item.prefab} at {item.key}{item.rot === undefined ? "" : ` · ${Math.round(item.rot * 180 / Math.PI)}°`}</li>)}{conflict.draftObjects.length > 12 && <li>…and {conflict.draftObjects.length - 12} more objects</li>}</ul>}
      <div className="mt-2 flex gap-1"><button className="rounded bg-slate-700 px-2 py-1" onClick={() => void reloadTheirs().catch(() => setError("Unable to load the latest world."))}>Discard mine & reload theirs</button><button className="rounded bg-amber-700 px-2 py-1" onClick={() => void publish(true)}>Publish my additions</button></div>
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
      {zoneRoom && <div className="mt-1 space-y-1"><div className="grid grid-cols-2 gap-1"><label>X<input key={`${zoneRoom}-x-${rooms.find(room => room.id === zoneRoom)?.rect.join("-")}`} className="ml-1 w-10 rounded bg-slate-800 p-1" type="number" min="0" max={worldSize ? worldSize[0] - 1 : undefined} defaultValue={rooms.find(room => room.id === zoneRoom)?.rect[0] ?? 0} onBlur={event => void moveRoom(Math.floor(Number(event.target.value)), rooms.find(room => room.id === zoneRoom)?.rect[1] ?? 0)} /></label><label>Z<input key={`${zoneRoom}-z-${rooms.find(room => room.id === zoneRoom)?.rect.join("-")}`} className="ml-1 w-10 rounded bg-slate-800 p-1" type="number" min="0" max={worldSize ? worldSize[1] - 1 : undefined} defaultValue={rooms.find(room => room.id === zoneRoom)?.rect[1] ?? 0} onBlur={event => void moveRoom(rooms.find(room => room.id === zoneRoom)?.rect[0] ?? 0, Math.floor(Number(event.target.value)))} /></label><label>Width<input key={`${zoneRoom}-width-${rooms.find(room => room.id === zoneRoom)?.rect.join("-")}`} className="ml-1 w-10 rounded bg-slate-800 p-1" type="number" min="1" max={worldSize ? worldSize[0] : undefined} defaultValue={(rooms.find(room => room.id === zoneRoom)?.rect[2] ?? 0) - (rooms.find(room => room.id === zoneRoom)?.rect[0] ?? 0) + 1} onBlur={event => void resizeRoom(Math.floor(Number(event.target.value)), (rooms.find(room => room.id === zoneRoom)?.rect[3] ?? 0) - (rooms.find(room => room.id === zoneRoom)?.rect[1] ?? 0) + 1)} /></label><label>Height<input key={`${zoneRoom}-height-${rooms.find(room => room.id === zoneRoom)?.rect.join("-")}`} className="ml-1 w-10 rounded bg-slate-800 p-1" type="number" min="1" max={worldSize ? worldSize[1] : undefined} defaultValue={(rooms.find(room => room.id === zoneRoom)?.rect[3] ?? 0) - (rooms.find(room => room.id === zoneRoom)?.rect[1] ?? 0) + 1} onBlur={event => void resizeRoom((rooms.find(room => room.id === zoneRoom)?.rect[2] ?? 0) - (rooms.find(room => room.id === zoneRoom)?.rect[0] ?? 0) + 1, Math.floor(Number(event.target.value)))} /></label></div><label className="flex items-center gap-1"><input type="checkbox" checked={currentRules.silent ?? false} onChange={event => void applyRules({ silent: event.target.checked })} /> Silent zone</label><label className="flex items-center gap-1"><input type="checkbox" checked={currentRules.focusable ?? false} onChange={event => void applyRules({ focusable: event.target.checked })} /> Focusable</label><label className="flex items-center gap-1"><input type="checkbox" checked={currentRules.locked ?? false} onChange={event => void applyRules({ locked: event.target.checked })} /> Locked</label><label className="block">Capacity<input className="ml-1 w-12 rounded bg-slate-800 p-1" type="number" min="0" value={currentRules.capacity ?? 0} onChange={event => void applyRules({ capacity: Math.max(0, Number(event.target.value) || 0) })} /></label><label className="block">Access<select className="ml-1 rounded bg-slate-800 p-1" value={(currentRules.roles ?? []).join(",")} onChange={event => void applyRules({ roles: event.target.value ? event.target.value.split(",") as Array<"founder" | "member"> : [] })}><option value="">Everyone</option><option value="founder">Founder only</option><option value="member">Members only</option><option value="founder,member">Founder and members</option></select></label><label className="block">Ambience<select className="ml-1 rounded bg-slate-800 p-1" value={currentRules.ambience ?? "none"} onChange={event => void applyRules({ ambience: event.target.value as "none" | "focus" | "social" | "meeting" })}><option value="none">None</option><option value="focus">Focus</option><option value="social">Social</option><option value="meeting">Meeting</option></select></label><label className="block">Entry note<input className="ml-1 w-full rounded bg-slate-800 p-1" maxLength={120} value={currentRules.tooltip ?? ""} placeholder="Shown on entry" onChange={event => void applyRules({ tooltip: event.target.value })} /></label><button className="w-full rounded bg-slate-800 p-1 text-left hover:bg-slate-700" onClick={() => void setSpawn()}>Set founder/default spawn here</button></div>}
    </div>
    <div className="mb-2 rounded bg-slate-900 p-2 text-[11px]"><label className="block opacity-70">Personal desk</label>{seats.filter(seat => !seat.owner).slice(0, 8).map(seat => <button key={seat.id} className="mt-1 block w-full rounded bg-slate-800 p-1 text-left hover:bg-slate-700" onClick={() => { void props.onClaimDesk(seat.id).then(() => { setSeats(current => current.map(item => item.id === seat.id ? { ...item, owner: "founder" } : item)); window.dispatchEvent(new Event("office3:refresh-scene")); window.dispatchEvent(new CustomEvent("office3:toast", { detail: { text: "Desk claimed and updated in the 3D office.", priority: "success" } })); }).catch(() => setError("This desk is no longer available.")); }}>Claim {seat.room} desk ({seat.pos[0]}, {seat.pos[1]})</button>)}</div>
    <details className="mb-2 rounded bg-slate-900 p-2 text-[11px]"><summary>World explorer · {objects.length} objects · {seats.length} seats · {rooms.length} rooms</summary><input className="mt-2 w-full rounded bg-slate-800 p-1" placeholder="Filter objects…" value={explorerQuery} onChange={event => setExplorerQuery(event.target.value)} />{explorerObjects.map(item => <button key={item.id} className={`mt-1 block w-full rounded p-1 text-left ${selectedObjectId === item.id ? "bg-blue-700" : "bg-slate-800 hover:bg-slate-700"}`} onClick={() => { setSelected(item.prefab); setSelectedObjectId(item.id); props.onSelect(item.prefab); }}><span className="block truncate">{item.prefab}</span><span className="opacity-60">{item.id} · ({item.pos[0]}, {item.pos[1]}) · {Math.round(item.rot * 180 / Math.PI)}°</span></button>)}{objects.length > explorerObjects.length && <p className="mt-1 opacity-60">Showing first 30 matching objects.</p>}</details>
    {selectedObject && <section className="mb-2 rounded bg-slate-900 p-2 text-[11px]"><div className="font-medium">Object inspector</div><p className="truncate opacity-60">{selectedObject.prefab} · {selectedObject.id}</p><div className="mt-1 grid grid-cols-2 gap-1"><label>X<input key={`${selectedObject.id}-x-${selectedObject.pos[0]}`} className="ml-1 w-12 rounded bg-slate-800 p-1" type="number" min="0" max={worldSize ? worldSize[0] - 1 : undefined} defaultValue={selectedObject.pos[0]} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== selectedObject.pos[0]) void updateObject({ pos: [Math.floor(value), selectedObject.pos[1]] }); }} /></label><label>Z<input key={`${selectedObject.id}-z-${selectedObject.pos[1]}`} className="ml-1 w-12 rounded bg-slate-800 p-1" type="number" min="0" max={worldSize ? worldSize[1] - 1 : undefined} defaultValue={selectedObject.pos[1]} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== selectedObject.pos[1]) void updateObject({ pos: [selectedObject.pos[0], Math.floor(value)] }); }} /></label><label>Degrees<input key={`${selectedObject.id}-rot-${selectedObject.rot}`} className="ml-1 w-12 rounded bg-slate-800 p-1" type="number" defaultValue={Math.round(selectedObject.rot * 180 / Math.PI)} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value)) void updateObject({ rot: value * Math.PI / 180 }); }} /></label><label>Scale<input key={`${selectedObject.id}-scale-${selectedObject.scale}`} className="ml-1 w-12 rounded bg-slate-800 p-1" type="number" min="0.1" max="8" step="0.1" defaultValue={selectedObject.scale} onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value >= .1 && value <= 8) void updateObject({ scale: value }); }} /></label></div><div className="mt-2 grid grid-cols-3 gap-1"><button type="button" className="rounded bg-slate-800 p-1 hover:bg-slate-700" onClick={() => void updateObject({ pos: [selectedObject.pos[0] - 1, selectedObject.pos[1]] })}>← Move</button><button type="button" className="rounded bg-slate-800 p-1 hover:bg-slate-700" onClick={() => void updateObject({ pos: [selectedObject.pos[0], selectedObject.pos[1] - 1] })}>↑ Move</button><button type="button" className="rounded bg-slate-800 p-1 hover:bg-slate-700" onClick={() => void updateObject({ pos: [selectedObject.pos[0], selectedObject.pos[1] + 1] })}>↓ Move</button><button type="button" className="rounded bg-slate-800 p-1 hover:bg-slate-700" onClick={() => void updateObject({ pos: [selectedObject.pos[0] + 1, selectedObject.pos[1]] })}>→ Move</button><button type="button" className="rounded bg-indigo-800 p-1 hover:bg-indigo-700" onClick={() => void updateObject({ rot: selectedObject.rot + Math.PI / 2 })}>Rotate 90°</button><button type="button" className="rounded bg-slate-800 p-1 hover:bg-slate-700" onClick={() => void updateObject({ scale: 1 })}>Reset scale</button></div><p className="mt-1 opacity-60">Changes persist on field exit. Quick actions use the same validated save path.</p></section>}
    {snapshots.length > 0 && <details className="mb-2 text-[11px]"><summary>Version history ({snapshots.length})</summary>{snapshots.slice(0, 5).map(snapshot => <button key={snapshot.id} className="mt-1 block w-full rounded bg-slate-800 p-1 text-left hover:bg-slate-700" onClick={() => { void restoreSnapshot(snapshot.id).catch(() => setError("Snapshot restore failed.")); }}>Restore rev {snapshot.rev}</button>)}</details>}
    <p className="mb-2 text-[11px] opacity-70">Select an object, then click the grid to place. Click a placed object to select; R rotates and Del erases. Ctrl+Z/Y undo/redo.</p>
    <input className="mb-2 w-full rounded bg-slate-800 p-2 text-xs" value={query} placeholder="Find a prefab…" onChange={event => setQuery(event.target.value)} />
    <div className="grid grid-cols-2 gap-1">{visible.map(item => <button key={item.id} onClick={() => { setSelected(item.id); props.onSelect(item.id); }} className={`rounded p-2 text-left text-[11px] ${selected === item.id ? "bg-blue-600" : "bg-slate-800 hover:bg-slate-700"}`}><span className="block truncate">{item.name}</span><span className="opacity-50">{item.category}</span></button>)}</div>
  </aside>;
}
