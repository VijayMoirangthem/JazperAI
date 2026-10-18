import type { Agent } from '@/store/store';

export type LodLevel = 'cluster' | 'room' | 'avatar';

const BUSY = new Set(['working', 'thinking', 'compacting']);
const MAX_SPRITES = 50;
const CLUSTER_THRESHOLD = 15;

export function lodFromZoom(zoom: number): LodLevel {
  if (zoom < 0.5) return 'cluster';
  if (zoom < 1.5) return 'room';
  return 'avatar';
}

export function shouldClusterZone(agentCount: number, lod: LodLevel, expanded: boolean): boolean {
  return agentCount > CLUSTER_THRESHOLD && lod !== 'avatar' && !expanded;
}

export function isInViewport(
  px: number,
  py: number,
  bounds: { x: number; y: number; width: number; height: number },
  margin = 80,
): boolean {
  const left = bounds.x - bounds.width / 2 - margin;
  const right = bounds.x + bounds.width / 2 + margin;
  const top = bounds.y - bounds.height / 2 - margin;
  const bottom = bounds.y + bounds.height / 2 + margin;
  return px >= left && px <= right && py >= top && py <= bottom;
}

export function shouldAnimateAgent(agent: Agent, rt: { lastAnimTs?: number }): boolean {
  if (BUSY.has(agent.status)) return true;
  const ts = rt.lastAnimTs ?? 0;
  return Date.now() - ts < 5 * 60 * 1000;
}

export function touchAnimTs(rt: { lastAnimTs?: number }, agent: Agent): void {
  if (BUSY.has(agent.status) || agent.action) {
    rt.lastAnimTs = Date.now();
  }
}

export const LOD_MAX_SPRITES = MAX_SPRITES;
