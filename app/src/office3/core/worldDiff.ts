import type { World } from "./world.ts";

export interface ObjectDiff { added: string[]; removed: string[]; changed: string[]; unchanged: number }
type Obj = World["objects"][number];

const same = (a: Obj, b: Obj): boolean =>
  a.prefab === b.prefab && a.pos[0] === b.pos[0] && a.pos[1] === b.pos[1] && a.rot === b.rot && a.scale === b.scale &&
  JSON.stringify(Object.entries(a.props ?? {}).sort()) === JSON.stringify(Object.entries(b.props ?? {}).sort());

/** Object-by-object comparison of two worlds, keyed by object id (local draft vs remote copy). Output ids are sorted and capped. */
export function diffObjects(local: World, remote: World, cap = 500): ObjectDiff {
  const theirs = new Map(remote.objects.map(o => [o.id, o]));
  const mine = new Map(local.objects.map(o => [o.id, o]));
  const out: ObjectDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [id, o] of mine) {
    const other = theirs.get(id);
    if (!other) out.added.push(id);
    else if (same(o, other)) out.unchanged++;
    else out.changed.push(id);
  }
  for (const id of theirs.keys()) if (!mine.has(id)) out.removed.push(id);
  for (const key of ["added", "removed", "changed"] as const) out[key] = out[key].sort().slice(0, cap);
  return out;
}

export const describeDiff = (d: ObjectDiff): string =>
  `${d.added.length} added, ${d.removed.length} removed, ${d.changed.length} changed, ${d.unchanged} unchanged`;
