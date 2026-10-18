import type { Agent, DepartmentZone, Room } from '@/store/store';

export interface RoomBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoneLayout {
  zoneX: number;
  zoneWidth: number;
  mapHeight: number;
  rooms: Map<string, RoomBounds>;
}

const ACTIVE_STATUSES = new Set(['working', 'thinking', 'compacting', 'blocked', 'waiting']);

export function isDeployedOnFloor(agent: Agent): boolean {
  return agent.deploymentStatus === 'deployed' || (!agent.deploymentStatus && agent.status !== 'ghost');
}

export function filterByRoster(agents: Agent[], filter: 'deployed' | 'planned' | 'all'): Agent[] {
  if (filter === 'all') return agents;
  if (filter === 'deployed') return agents.filter(isDeployedOnFloor);
  return agents.filter((a) => a.deploymentStatus === 'planned' || a.deploymentStatus === 'catalogue');
}

export function agentsOnFloor(
  agents: Agent[],
  floorId: string,
  rosterFilter?: 'deployed' | 'planned' | 'all',
): Agent[] {
  let list = agents.filter((a) => (a.floorId ?? 'floor-1') === floorId);
  if (rosterFilter && rosterFilter !== 'all') {
    list = filterByRoster(list, rosterFilter);
  } else {
    list = list.filter(isDeployedOnFloor);
  }
  return list;
}

export function activeCount(agents: Agent[]): number {
  return agents.filter((a) => ACTIVE_STATUSES.has(a.status)).length;
}

/** Lay out team rooms as sub-bands inside each visible department wing. */
export function computeZoneLayout(
  zone: DepartmentZone,
  zoneX: number,
  zoneWidth: number,
  mapHeight: number,
): ZoneLayout {
  const rooms = zone.rooms.length > 0 ? zone.rooms : [{
    id: `team_${zone.id}`,
    zoneId: zone.id,
    name: zone.label,
    type: 'huddle' as const,
    capacity: 24,
    assignedAgents: [],
    amenities: [],
    bookable: false,
  }];
  const roomBounds = new Map<string, RoomBounds>();
  const roomH = Math.max(60, mapHeight - 48);
  const roomW = zoneWidth / rooms.length;
  rooms.forEach((room, i) => {
    roomBounds.set(room.id, {
      x: zoneX + i * roomW + 4,
      y: 44,
      width: roomW - 8,
      height: roomH - 52,
    });
  });
  return { zoneX, zoneWidth, mapHeight, rooms: roomBounds };
}

/** Assign seat indices grouped by team, ordered by desk_slot within team. */
export function buildSeatAssignment(
  agents: Agent[],
  seatCount: number,
  godSeat: number,
): Map<string, number> {
  const map = new Map<string, number>();
  const byTeam = new Map<string, Agent[]>();
  for (const a of agents) {
    if (a.isGod) {
      map.set(a.id, godSeat);
      continue;
    }
    const tid = a.teamId ?? `solo_${a.departmentId ?? a.id}`;
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid)!.push(a);
  }
  let idx = 1;
  for (const [, members] of [...byTeam.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    members.sort((x, y) => (x.deskSlot ?? 0) - (y.deskSlot ?? 0));
    for (const m of members) {
      if (idx < seatCount) {
        map.set(m.id, idx);
        idx += 1;
      }
    }
  }
  return map;
}

export function teamRoomCenter(
  teamId: string | undefined,
  zone: DepartmentZone,
  layout: ZoneLayout,
): { x: number; y: number } | null {
  const roomId = teamId ?? `team_${zone.id}`;
  const bounds = layout.rooms.get(roomId) ?? layout.rooms.values().next().value;
  if (!bounds) return null;
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function avgHealth(agents: Agent[]): number {
  if (agents.length === 0) return 100;
  return agents.reduce((s, a) => s + (a.healthScore ?? 100), 0) / agents.length;
}
