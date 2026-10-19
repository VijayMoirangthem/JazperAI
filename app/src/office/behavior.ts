/** Pure rules: which place an agent goes to for a given state (pattern: age-of-agents "the tool decides the workshop"). */
export type Place = "desk" | "meeting" | "tools" | "lounge";

export function placeFor(state: string, hour: number): Place {
  switch (state) {
    case "planning": return "meeting";
    case "waiting_tool":
    case "testing":
    case "repairing": return "tools";
    case "working":
    case "waiting_human":
    case "error": return "desk";
    default: return hour >= 12 && hour < 13 ? "lounge" : "desk"; // idle: lunch hour in the lounge, otherwise at the desk
  }
}

/** First free spot (stable order); when all are taken, spots are shared round-robin by `index`. */
export function pickSpot<T>(spots: readonly T[], taken: ReadonlySet<string>, key: (s: T) => string, index = 0): T | undefined {
  if (!spots.length) return undefined;
  return spots.find((s) => !taken.has(key(s))) ?? spots[index % spots.length];
}

export type Pt = readonly [number, number];

/** 4-neighbour BFS over a blocked grid; returns the path excluding the start, or [] when unreachable. */
export function bfs(blocked: boolean[][], from: Pt, to: Pt): Pt[] {
  const H = blocked.length, W = blocked[0].length;
  const k = (x: number, y: number) => y * W + x;
  if (to[0] < 0 || to[1] < 0 || to[0] >= W || to[1] >= H || blocked[to[1]][to[0]]) return [];
  const prev = new Map<number, number>([[k(from[0], from[1]), -1]]);
  const q: Pt[] = [from];
  for (let i = 0; i < q.length; i++) {
    const [x, y] = q[i];
    if (x === to[0] && y === to[1]) break;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || blocked[ny][nx] || prev.has(k(nx, ny))) continue;
      prev.set(k(nx, ny), k(x, y));
      q.push([nx, ny]);
    }
  }
  if (!prev.has(k(to[0], to[1]))) return [];
  const out: Pt[] = [];
  for (let c = k(to[0], to[1]); c !== -1; c = prev.get(c)!) out.unshift([c % W, Math.floor(c / W)]);
  return out.slice(1);
}

export const near = (a: Pt, b: Pt, r = 2): boolean => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) <= r;
