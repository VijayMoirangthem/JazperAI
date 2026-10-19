// BFS pathfinding over a walkable grid.

export interface Grid {
  w: number;
  h: number;
  /** true = walkable */
  walk: Uint8Array;
}

export function inBounds(g: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < g.w && y < g.h;
}

export function isWalkable(g: Grid, x: number, y: number): boolean {
  return inBounds(g, x, y) && g.walk[y * g.w + x] === 1;
}

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function findPath(g: Grid, sx: number, sy: number, tx: number, ty: number): Array<[number, number]> {
  if (!isWalkable(g, sx, sy) || !isWalkable(g, tx, ty)) return [];
  const key = (x: number, y: number) => y * g.w + x;
  const prev = new Int32Array(g.w * g.h).fill(-1);
  const visited = new Uint8Array(g.w * g.h);
  const q: number[] = [key(sx, sy)];
  visited[key(sx, sy)] = 1;
  const target = key(tx, ty);

  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (cur === target) break;
    const cx = cur % g.w, cy = Math.floor(cur / g.w);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!isWalkable(g, nx, ny)) continue;
      const nk = key(nx, ny);
      if (visited[nk]) continue;
      visited[nk] = 1;
      prev[nk] = cur;
      q.push(nk);
    }
  }

  if (!visited[target]) return [];
  const path: Array<[number, number]> = [];
  let cur = target;
  while (cur !== -1) {
    path.push([cur % g.w, Math.floor(cur / g.w)]);
    cur = prev[cur];
  }
  path.reverse();
  return path;
}