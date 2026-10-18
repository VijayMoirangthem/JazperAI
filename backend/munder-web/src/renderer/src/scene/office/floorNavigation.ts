import { useStore, type DepartmentZone, type FloorCameraHandle } from '@/store/store';

/** Ensure a department wing is inside the visible zone range before panning. */
export function ensureZoneVisible(zoneId: string): void {
  const zones = useStore.getState().departmentZones.filter((z) => z.expanded);
  const idx = zones.findIndex((z) => z.id === zoneId);
  if (idx < 0) return;
  const [start, end] = useStore.getState().visibleZoneRange;
  const width = end - start + 1;
  if (idx >= start && idx <= end) return;
  const newStart = Math.max(0, Math.min(zones.length - width, idx - Math.floor(width / 2)));
  useStore.getState().setVisibleZoneRange([newStart, newStart + width - 1]);
}

export function focusDepartmentZone(
  zoneId: string,
  camera: FloorCameraHandle | null,
  zones: DepartmentZone[],
  mapW: number,
  mapH: number,
): void {
  if (!camera) return;
  ensureZoneVisible(zoneId);
  const expanded = useStore.getState().departmentZones.filter((z) => z.expanded);
  const idx = expanded.findIndex((z) => z.id === zoneId);
  if (idx < 0) return;
  const zoneWidth = Math.max(120, mapW / Math.max(expanded.length, 3));
  const x = idx * zoneWidth + zoneWidth / 2;
  camera.focusOnZone(x, mapH / 2, 1.5);
}

export function focusAgent(
  agentId: string,
  camera: FloorCameraHandle | null,
): void {
  const store = useStore.getState();
  store.selectAgent(agentId);
  const agent = store.agents.find((a) => a.id === agentId);
  if (agent?.departmentId) {
    ensureZoneVisible(agent.departmentId);
  }
  window.setTimeout(() => camera?.focusSelected?.(), 50);
}

export function focusTeam(
  teamId: string,
  camera: FloorCameraHandle | null,
  mapW: number,
  mapH: number,
): void {
  const store = useStore.getState();
  const team = store.orgTeams.find((t) => t.id === teamId);
  if (!team) return;
  focusDepartmentZone(team.departmentId, camera, store.departmentZones, mapW, mapH);
  const member = store.agents.find((a) => a.teamId === teamId);
  if (member) {
    store.selectAgent(member.id);
    window.setTimeout(() => camera?.focusSelected?.(), 80);
  }
}

export function focusFloor(floorId: string, camera: FloorCameraHandle | null): void {
  useStore.getState().setCurrentFloorId(floorId);
  camera?.resetZoom();
}
