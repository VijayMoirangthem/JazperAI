"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

type MinimapWorld = { size: { w: number; h: number }; rooms: Array<{ id: string; label: string; rect: [number, number, number, number] }> };
type MinimapActor = { slug: string; kind: "human" | "agent" | "bot"; x: number; z: number; state: string };
type MinimapCamera = { x: number; z: number; tx: number; tz: number };
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const CANVAS_WIDTH = 144, CANVAS_HEIGHT = 96;

const layoutFor = (world: MinimapWorld) => {
  const scale = Math.max(.5, Math.min((CANVAS_WIDTH - 8) / world.size.w, (CANVAS_HEIGHT - 8) / world.size.h));
  return { scale, left: (CANVAS_WIDTH - world.size.w * scale) / 2, top: (CANVAS_HEIGHT - world.size.h * scale) / 2 };
};

export function Minimap3D() {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; z: number } | null>(null);
  const didDrag = useRef(false);
  const [world, setWorld] = useState<MinimapWorld | null>(null);
  const [actors, setActors] = useState<MinimapActor[]>([]);
  const [camera, setCamera] = useState<MinimapCamera | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const load = async () => {
      let value: unknown;
      try {
        const response = await fetch(`${API}/api/v1/office/world`);
        value = response.ok ? (await response.json()).world : await fetch("/office3/world.json").then(fallback => fallback.json());
      } catch {
        try { value = await fetch("/office3/world.json").then(fallback => fallback.json()); } catch { return; }
      }
      if (live && value && typeof value === "object" && "size" in value && "rooms" in value) setWorld(value as MinimapWorld);
    };
    load();
    window.addEventListener("office3:refresh-scene", load);
    window.addEventListener("office3:refresh-minimap", load);
    return () => { live = false; window.removeEventListener("office3:refresh-scene", load); window.removeEventListener("office3:refresh-minimap", load); };
  }, []);
  useEffect(() => { if (world && !world.rooms.some(room => room.id === selectedRoomId)) setSelectedRoomId(world.rooms[0]?.id ?? null); }, [selectedRoomId, world]);
  useEffect(() => {
    const refreshActors = () => {
      const debug = window.__office3Debug;
      if (!debug) return;
      setActors(debug.actors().map(actor => ({ slug: actor.slug, kind: actor.kind, x: actor.x, z: actor.z, state: actor.state })));
      const view = debug.camera();
      setCamera({ x: view.x, z: view.z, tx: view.tx, tz: view.tz });
    };
    refreshActors();
    const timer = window.setInterval(refreshActors, 700);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const canvas = ref.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#101820"; context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!world) return;
    const { scale, left, top } = layoutFor(world);
    context.strokeStyle = "#475569"; context.strokeRect(left, top, world.size.w * scale, world.size.h * scale);
    for (const room of world.rooms) {
      const [x1, z1, x2, z2] = room.rect, x = left + x1 * scale, z = top + z1 * scale, width = (x2 - x1 + 1) * scale, height = (z2 - z1 + 1) * scale;
      context.fillStyle = "#29445d"; context.fillRect(x, z, width, height);
      context.strokeStyle = room.id === selectedRoomId ? "#fbbf24" : room.id === hoveredRoomId ? "#a5f3fc" : "#67e8f9"; context.lineWidth = room.id === selectedRoomId ? 2 : room.id === hoveredRoomId ? 1.5 : 1; context.strokeRect(x, z, width, height); context.lineWidth = 1;
      if (width >= 26 && height >= 13) { context.fillStyle = "#d9e7f2"; context.font = "8px sans-serif"; context.fillText(room.label.slice(0, 16), x + 2, z + 10); }
    }
    if (camera) {
      const x = left + camera.tx * scale, z = top + camera.tz * scale;
      const angle = Math.atan2(camera.tz - camera.z, camera.tx - camera.x), spread = .38, radius = Math.max(7, Math.min(16, 10 * scale));
      context.beginPath(); context.moveTo(x, z); context.arc(x, z, radius, angle - spread, angle + spread); context.closePath(); context.fillStyle = "rgba(96,165,250,.28)"; context.fill();
      context.beginPath(); context.moveTo(x, z); context.lineTo(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius); context.strokeStyle = "#93c5fd"; context.lineWidth = 1; context.stroke();
    }
    for (const actor of actors) {
      const x = left + actor.x * scale, z = top + actor.z * scale;
      context.fillStyle = actor.kind === "human" ? "#fbbf24" : actor.state === "waiting_human" || actor.state === "escalated" ? "#fb7185" : "#e2e8f0";
      context.beginPath(); context.arc(x, z, actor.kind === "human" ? 3 : 1.8, 0, Math.PI * 2); context.fill();
    }
  }, [actors, camera, hoveredRoomId, selectedRoomId, world]);
  const tileFor = (event: ReactMouseEvent<HTMLCanvasElement> | ReactPointerEvent<HTMLCanvasElement>) => {
    if (!world || !ref.current) return;
    const bounds = ref.current.getBoundingClientRect(), x = (event.clientX - bounds.left) * CANVAS_WIDTH / bounds.width, z = (event.clientY - bounds.top) * CANVAS_HEIGHT / bounds.height;
    const { scale, left, top } = layoutFor(world);
    return { x: Math.max(0, Math.min(world.size.w - .5, (x - left) / scale)), z: Math.max(0, Math.min(world.size.h - .5, (z - top) / scale)) };
  };
  const focusRoom = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    if (didDrag.current) { didDrag.current = false; return; }
    const tile = tileFor(event);
    if (!world || !tile) return;
    const tileX = Math.floor(tile.x), tileZ = Math.floor(tile.z);
    const room = world.rooms.find(item => tileX >= item.rect[0] && tileX <= item.rect[2] && tileZ >= item.rect[1] && tileZ <= item.rect[3]);
    if (room) { setSelectedRoomId(room.id); window.dispatchEvent(new CustomEvent("office3:focus-room", { detail: room.id })); }
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => { const tile = tileFor(event); if (!tile) return; drag.current = tile; didDrag.current = false; event.currentTarget.setPointerCapture(event.pointerId); };
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => { const tile = tileFor(event), start = drag.current; if (!tile || !start) return; if (Math.hypot(tile.x - start.x, tile.z - start.z) > .5) didDrag.current = true; };
  const onPointerHover = (event: ReactPointerEvent<HTMLCanvasElement>) => { const tile = tileFor(event); if (!world || !tile) return; const x = Math.floor(tile.x), z = Math.floor(tile.z); setHoveredRoomId(world.rooms.find(room => x >= room.rect[0] && x <= room.rect[2] && z >= room.rect[1] && z <= room.rect[3])?.id ?? null); };
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => { const tile = tileFor(event); if (tile && didDrag.current) window.dispatchEvent(new CustomEvent("office3:focus-point", { detail: tile })); drag.current = null; };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!world?.rooms.length) return;
    const index = Math.max(0, world.rooms.findIndex(room => room.id === selectedRoomId));
    if (["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) { event.preventDefault(); const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1; setSelectedRoomId(world.rooms[(index + step + world.rooms.length) % world.rooms.length].id); return; }
    if ((event.key === "Enter" || event.key === " ") && selectedRoomId) { event.preventDefault(); window.dispatchEvent(new CustomEvent("office3:focus-room", { detail: selectedRoomId })); }
  };
  const hoveredRoom = world?.rooms.find(room => room.id === hoveredRoomId);
  return <canvas ref={ref} width={CANVAS_WIDTH} height={CANVAS_HEIGHT} onClick={focusRoom} onPointerDown={onPointerDown} onPointerMove={event => { onPointerMove(event); onPointerHover(event); }} onPointerLeave={() => setHoveredRoomId(null)} onPointerUp={onPointerUp} onKeyDown={onKeyDown} tabIndex={0} role="button" aria-label={`Office minimap${hoveredRoom ? `. ${hoveredRoom.label}` : ""}. Click a room to focus it, drag to move the camera, or use arrow keys then Enter.`} title={hoveredRoom ? `${hoveredRoom.label} — click to focus` : "Click a room to focus it; drag to move the camera"} className="absolute bottom-3 right-3 cursor-pointer rounded border border-white/20 bg-black/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300" />;
}
