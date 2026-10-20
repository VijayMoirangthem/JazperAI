import type { Area, Facing, MapModel, Spot } from "./types.ts";

interface TiledProp { name: string; value: unknown }
interface TiledObject { name?: string; class?: string; type?: string; x: number; y: number; width?: number; height?: number; point?: boolean; properties?: TiledProp[] }
interface TiledLayer { name: string; type: string; data?: number[]; objects?: TiledObject[]; properties?: TiledProp[] }
interface TiledMap { width: number; height: number; tilewidth: number; layers: TiledLayer[] }

const props = (o: { properties?: TiledProp[] }): Record<string, unknown> => Object.fromEntries((o.properties ?? []).map((p) => [p.name, p.value]));
const FACINGS = new Set(["up", "down", "left", "right"]);

/** Tiled JSON -> MapModel. Throws Error with a readable message when the map breaks the contract in docs/virtualOffice/03_target_design.md section 3. */
export function parseMap(json: unknown): MapModel {
  const m = json as TiledMap;
  const { width, height } = m;
  const tile = m.tilewidth;
  const blocked: boolean[][] = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  for (const l of m.layers) {
    if (l.type !== "tilelayer" || props(l).collides !== true) continue;
    l.data!.forEach((gid, i) => { if (gid) blocked[Math.floor(i / width)][i % width] = true; });
  }
  const layer = (name: string) => m.layers.find((l) => l.name === name && l.type === "objectgroup");
  const areas: Area[] = (layer("zones")?.objects ?? []).filter((o) => o.class === "area").map((o) => {
    const p = props(o);
    return {
      room: String(p.room), label: String(p.label ?? p.room), kind: String(p.kind ?? "work"),
      x: Math.round(o.x / tile), y: Math.round(o.y / tile), w: Math.round((o.width ?? 0) / tile), h: Math.round((o.height ?? 0) / tile),
      silent: p.silent === true, focusable: p.focusable === true, capacity: Number(p.capacity ?? 0),
    };
  });
  const spots: Spot[] = [];
  let start: [number, number] | null = null;
  for (const o of layer("spots")?.objects ?? []) {
    const p = props(o), tx = Math.floor(o.x / tile), ty = Math.floor(o.y / tile);
    if (o.class === "start" || p.start === true) { start = [tx, ty]; continue; }
    if (o.class !== "seat" && o.class !== "spot") continue;
    const facing = typeof p.facing === "string" && FACINGS.has(p.facing) ? (p.facing as Facing) : undefined;
    spots.push({ type: o.class, room: String(p.room), slot: Number(p.slot ?? 0), x: tx, y: ty, ...(facing ? { facing } : {}), ...(typeof p.owner === "string" ? { owner: p.owner } : {}) });
  }
  if (!start) throw new Error("map has no start point (object with class 'start' in layer 'spots')");

  const rooms = new Set(areas.map((a) => a.room));
  for (const need of ["engineering", "operations", "meeting", "tools", "lounge", "founder"]) if (!rooms.has(need)) throw new Error(`map is missing room '${need}'`);
  for (const s of spots) {
    if (!rooms.has(s.room)) throw new Error(`spot ${s.room}-${s.slot} refers to unknown room '${s.room}'`);
    if (blocked[s.y]?.[s.x] !== false) throw new Error(`spot ${s.room}-${s.slot} at ${s.x},${s.y} is blocked or outside the map`);
  }
  // reachability from start
  const seen = Array.from({ length: height }, () => Array<boolean>(width).fill(false));
  if (blocked[start[1]][start[0]]) throw new Error("start point is blocked");
  const q: [number, number][] = [start];
  seen[start[1]][start[0]] = true;
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height || blocked[ny][nx] || seen[ny][nx]) continue;
      seen[ny][nx] = true;
      q.push([nx, ny]);
    }
  }
  for (const s of spots) if (!seen[s.y][s.x]) throw new Error(`spot ${s.room}-${s.slot} at ${s.x},${s.y} is not reachable from start`);
  const workSeats = spots.filter((s) => s.type === "seat" && areas.find((a) => a.room === s.room)?.kind === "work").length;
  if (workSeats < 24) throw new Error(`need at least 24 work seats, found ${workSeats}`);

  return {
    width, height, tile, blocked, areas, spots, start: start as [number, number],
    roomAt(x, y) {
      let best: Area | null = null;
      for (const a of areas) if (x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h && (!best || a.w * a.h < best.w * best.h)) best = a;
      return best ? best.room : null;
    },
  };
}
