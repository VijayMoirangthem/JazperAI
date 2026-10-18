// Builds the office floor grid + rooms + desks from department data.
// Departments carry a floor_position of {x, y} on a 7x3 city grid (see
// backend db/init.py seeds). Each cell becomes a room with walls and doors
// opening into corridor lines, so the whole floor is one connected space.

import type { FloorAgent, FloorDept, Room, Desk } from "./types";

export const PITCH_X = 9; // tiles per column cell (1 wall + 6 interior + 1 wall + 1 corridor)
export const PITCH_Y = 7; // tiles per row cell    (1 wall + 4 interior + 1 wall + 1 corridor)
export const COLS = 7;
export const ROWS = 3;
export const GRID_W = COLS * PITCH_X - 1; // 62
export const GRID_H = ROWS * PITCH_Y - 1; // 20

export interface OfficeMap {
  w: number;
  h: number;
  walk: Uint8Array;
  rooms: Room[];
  desks: Desk[];
  cellByDept: Map<string, { cx: number; cy: number }>;
  spawn: { x: number; y: number }; // lobby / commons
  commons: { x: number; y: number; w: number; h: number };
}

const DEPT_FALLBACK: Record<string, { x: number; y: number }> = {
  executive: { x: 0, y: 0 }, intelligence: { x: 1, y: 0 }, communications: { x: 2, y: 0 },
  personal: { x: 3, y: 0 }, marketing: { x: 4, y: 0 }, sales: { x: 5, y: 0 },
  quality_assurance: { x: 6, y: 0 },
  operations: { x: 0, y: 1 }, it: { x: 1, y: 1 }, security: { x: 2, y: 1 },
  finance: { x: 3, y: 1 }, hr: { x: 4, y: 1 }, analytics: { x: 5, y: 1 },
  research: { x: 3, y: 2 }, relations: { x: 4, y: 2 }, creative: { x: 5, y: 2 },
};

export function deptCell(dept: FloorDept): { x: number; y: number } {
  const fp = dept.floor_position;
  if (fp && typeof fp.x === "number" && typeof fp.y === "number") return { x: fp.x, y: fp.y };
  return DEPT_FALLBACK[dept.id] ?? { x: 6, y: 2 };
}

export function roomRect(cx: number, cy: number) {
  const x0 = cx * PITCH_X;
  const y0 = cy * PITCH_Y;
  return {
    x0, y0,
    innerX: x0 + 1, innerY: y0 + 1,
    innerW: 6, innerH: 4,
    wallR: x0 + 7, wallB: y0 + 5,
    corridorCol: x0 + 8, corridorRow: y0 + 6,
  };
}

export function buildMap(depts: FloorDept[], agents: FloorAgent[]): OfficeMap {
  const walk = new Uint8Array(GRID_W * GRID_H);

  const isCorridorCol = (x: number) => x % PITCH_X === PITCH_X - 1;
  const isCorridorRow = (y: number) => y % PITCH_Y === PITCH_Y - 1;
  const key = (x: number, y: number) => y * GRID_W + x;

  // corridors first
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      if (isCorridorCol(x) || isCorridorRow(y)) walk[key(x, y)] = 1;
    }

  const rooms: Room[] = [];
  const cellByDept = new Map<string, { cx: number; cy: number }>();

  for (const dept of depts) {
    const { x: cx, y: cy } = deptCell(dept);
    const r = roomRect(cx, cy);
    // interior + doors (right wall middle, bottom wall middle)
    for (let y = r.innerY; y < r.innerY + r.innerH; y++)
      for (let x = r.innerX; x < r.innerX + r.innerW; x++)
        walk[key(x, y)] = 1;
    // doors open into the corridors
    walk[key(r.wallR, r.innerY + 1)] = 1;
    walk[key(r.innerX + 2, r.wallB)] = 1;
    cellByDept.set(dept.id, { cx, cy });
    rooms.push({
      id: dept.id,
      label: dept.name,
      color: dept.color,
      x: r.innerX, y: r.innerY, w: r.innerW, h: r.innerH,
      door: { x: r.wallR, y: r.innerY + 1 },
    });
  }

  // desks: distribute agents inside their room interior, Jazper at the centre
  const desks: Desk[] = [];
  const byDept = new Map<string, FloorAgent[]>();
  for (const a of agents) {
    if (!byDept.has(a.deptId)) byDept.set(a.deptId, []);
    byDept.get(a.deptId)!.push(a);
  }

  for (const dept of depts) {
    const list = byDept.get(dept.id) ?? [];
    const cell = cellByDept.get(dept.id)!;
    const r = roomRect(cell.cx, cell.cy);
    list.forEach((agent, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      let dx = r.innerX + 1 + col * 2;
      let dy = r.innerY + 1 + row;
      if (agent.isGod) {
        dx = r.innerX + 2;
        dy = r.innerY + 1;
      }
      // safety: keep within interior
      dx = Math.min(dx, r.innerX + r.innerW - 2);
      dy = Math.min(dy, r.innerY + r.innerH - 2);
      desks.push({ id: agent.id, roomId: dept.id, x: dx, y: dy });
    });
  }

  // commons / lobby — the corridor intersection at the front door
  const commons = {
    x: 0, y: 0,
    w: 0, h: 0,
  };

  return {
    w: GRID_W, h: GRID_H,
    walk,
    rooms,
    desks,
    cellByDept,
    spawn: { x: 0, y: GRID_H - 1 },
    commons,
  };
}

export function deskFor(map: OfficeMap, agentId: string): Desk | undefined {
  return map.desks.find(d => d.id === agentId);
}

export function roomFor(map: OfficeMap, agentId: string): Room | undefined {
  const d = deskFor(map, agentId);
  return d ? map.rooms.find(r => r.id === d.roomId) : undefined;
}

export function deptName(depts: FloorDept[], id: string): string {
  return depts.find(d => d.id === id)?.name ?? id;
}