import type { Pt } from "./types.ts";

export interface ProxPerson { id: string; tile: Pt; walking: boolean; silent?: boolean }
export interface ProxEvent { type: "join" | "leave"; id: string; groupId: string | null }
export interface ProxResult { groups: string[][]; events: ProxEvent[] }
export interface Proximity { update(people: readonly ProxPerson[]): ProxResult }

const dist = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** Proximity groups with hysteresis: a pair links at distance <= enter (both standing still), unlinks at distance > leave. Silent people never link. */
export function createProximity(opts: { enter: number; leave: number }): Proximity {
  let links = new Set<string>(); // "a|b" with a < b
  let member = new Map<string, string>(); // id -> groupId
  return {
    update(people) {
      const byId = new Map(people.map((p) => [p.id, p]));
      const next = new Set<string>();
      for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
        const a = people[i], b = people[j];
        if (a.silent || b.silent) continue;
        const k = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
        const d = dist(a.tile, b.tile);
        if (links.has(k) ? d <= opts.leave : d <= opts.enter && !a.walking && !b.walking) next.add(k);
      }
      links = next;
      // connected components over linked pairs
      const adj = new Map<string, string[]>();
      for (const k of links) { const [a, b] = k.split("|"); (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); }
      const seen = new Set<string>(), groups: string[][] = [];
      for (const id of [...adj.keys()].sort()) {
        if (seen.has(id) || !byId.has(id)) continue;
        const comp: string[] = [], stack = [id];
        seen.add(id);
        while (stack.length) { const c = stack.pop()!; comp.push(c); for (const n of adj.get(c) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
        groups.push(comp.sort());
      }
      groups.sort((x, y) => (x[0] < y[0] ? -1 : 1));
      const nextMember = new Map<string, string>();
      for (const g of groups) for (const id of g) nextMember.set(id, g[0]);
      const events: ProxEvent[] = [];
      for (const [id, gid] of nextMember) if (!member.has(id)) events.push({ type: "join", id, groupId: gid });
      for (const id of member.keys()) if (!nextMember.has(id)) events.push({ type: "leave", id, groupId: null });
      member = nextMember;
      return { groups, events };
    },
  };
}
