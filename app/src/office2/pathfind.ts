import type { Pt } from "./types.ts";

/** A* on a 4-neighbour grid. Returns the path WITHOUT the start tile, or [] when start == goal, the goal is blocked/out of range, or no route exists. */
export function findPath(blocked: boolean[][], from: Pt, to: Pt): Pt[] {
  const H = blocked.length, W = blocked[0].length;
  if (to[0] < 0 || to[1] < 0 || to[0] >= W || to[1] >= H || blocked[to[1]][to[0]]) return [];
  if (from[0] === to[0] && from[1] === to[1]) return [];
  const key = (x: number, y: number) => y * W + x;
  const h = (x: number, y: number) => Math.abs(x - to[0]) + Math.abs(y - to[1]);
  const g = new Map<number, number>([[key(from[0], from[1]), 0]]);
  const prev = new Map<number, number>();
  const open: { k: number; f: number }[] = [{ k: key(from[0], from[1]), f: h(from[0], from[1]) }];
  const closed = new Set<number>();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const { k } = open.splice(bi, 1)[0];
    if (closed.has(k)) continue;
    closed.add(k);
    const x = k % W, y = Math.floor(k / W);
    if (x === to[0] && y === to[1]) {
      const out: Pt[] = [];
      for (let c = k; c !== key(from[0], from[1]); c = prev.get(c)!) out.unshift([c % W, Math.floor(c / W)]);
      return out;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked[ny][nx]) continue;
      const nk = key(nx, ny), ng = g.get(k)! + 1;
      if (ng < (g.get(nk) ?? Infinity)) { g.set(nk, ng); prev.set(nk, k); open.push({ k: nk, f: ng + h(nx, ny) }); }
    }
  }
  return [];
}

/** Nearest tile to `target` (breadth-first rings) that is not blocked and not in `occupied` ("x,y" strings). Returns null when none exists. */
export function nearestFree(blocked: boolean[][], target: Pt, occupied: ReadonlySet<string>): Pt | null {
  const H = blocked.length, W = blocked[0].length;
  const seen = new Set<number>([target[1] * W + target[0]]);
  const q: Pt[] = [target];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    if (x >= 0 && y >= 0 && x < W && y < H && !blocked[y][x] && !occupied.has(`${x},${y}`)) return [x, y];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen.has(ny * W + nx)) continue;
      seen.add(ny * W + nx);
      q.push([nx, ny]);
    }
  }
  return null;
}
