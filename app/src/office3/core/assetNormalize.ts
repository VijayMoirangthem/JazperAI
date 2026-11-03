/** Pure normalisation of a loaded model's bounds into prefab placement data (scale, ground offset, footprint, anchors). No three.js needed. */
export interface Bounds { min: [number, number, number]; max: [number, number, number] }
export interface NamedPoint { name: string; pos: [number, number, number] }
export interface NormalizedAsset {
  scale: number; offset: [number, number, number]; footprint: [number, number]; height: number;
  seats: [number, number, number][]; anchors: Record<string, [number, number, number]>;
}

const ANCHOR = /^(anchor|seat|use|interact)[_.:-]?/i;

export function normalizeAsset(bounds: Bounds, tile: number, nodes: readonly NamedPoint[] = [], targetCells?: [number, number]): NormalizedAsset {
  const sx = bounds.max[0] - bounds.min[0], sy = bounds.max[1] - bounds.min[1], sz = bounds.max[2] - bounds.min[2];
  if (![sx, sy, sz, tile].every(Number.isFinite) || sx <= 0 || sz <= 0 || tile <= 0) throw Error("model bounds must be finite and non-empty");
  const cells: [number, number] = targetCells ?? [Math.max(1, Math.round(sx / tile)), Math.max(1, Math.round(sz / tile))];
  const scale = Math.min((cells[0] * tile) / sx, (cells[1] * tile) / sz);
  const cx = (bounds.min[0] + bounds.max[0]) / 2, cz = (bounds.min[2] + bounds.max[2]) / 2;
  const offset: [number, number, number] = [-cx * scale, -bounds.min[1] * scale, -cz * scale];
  const place = (p: [number, number, number]): [number, number, number] => [p[0] * scale + offset[0], p[1] * scale + offset[1], p[2] * scale + offset[2]];
  const seats: [number, number, number][] = [];
  const anchors: Record<string, [number, number, number]> = {};
  for (const n of nodes.slice(0, 64)) {
    if (!ANCHOR.test(n.name) || !n.pos.every(Number.isFinite)) continue;
    const p = place(n.pos);
    if (/^seat/i.test(n.name)) seats.push(p); else anchors[n.name.toLowerCase()] = p;
  }
  return { scale, offset, footprint: cells, height: sy * scale, seats, anchors };
}
