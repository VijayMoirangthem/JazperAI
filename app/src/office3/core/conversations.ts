import { createProximity } from "../../office2/proximity.ts";

export interface ConversationPerson { id: string; tile: readonly [number, number]; walking: boolean; silent?: boolean; dnd?: boolean; focus?: boolean; }
export interface ConversationResult { groups: string[][]; joined: string[]; left: string[]; lockedGroups: string[][]; }
const groupKey = (members: readonly string[]) => [...members].sort().join(":");

export function createConversations(capacity = 8) {
  const proximity = createProximity({ enter: 2, leave: 3 });
  const lockedGroups = new Map<string, string[]>();
  const departed = new Map<string, number>();
  let prior = new Set<string>();
  const lockGroup = (members: readonly string[]) => { const group = [...new Set(members)].sort(); if (group.length > 1) lockedGroups.set(groupKey(group), group); };
  const unlockGroup = (members: readonly string[]) => lockedGroups.delete(groupKey(members));
  const isGroupLocked = (members: readonly string[]) => lockedGroups.has(groupKey(members));
  return {
    lockGroup, unlockGroup, isGroupLocked,
    leave(id: string, durationMs = 4000) { departed.set(id, performance.now() + durationMs); },
    update(people: readonly ConversationPerson[]): ConversationResult {
      const now = performance.now();
      for (const [id, until] of departed) if (until <= now) departed.delete(id);
      const eligible = people.filter(person => !person.dnd && !person.focus && !departed.has(person.id));
      const raw = proximity.update(eligible.map(person => ({ id: person.id, tile: person.tile, walking: person.walking, silent: person.silent })));
      const groups = raw.groups.map(group => {
        const locked = [...lockedGroups.values()].find(members => members.every(id => group.includes(id)));
        return (locked ?? group).slice(0, capacity);
      }).filter(group => group.length > 1);
      const valid = new Set(groups.map(groupKey));
      for (const key of lockedGroups.keys()) if (!valid.has(key)) lockedGroups.delete(key);
      const next = new Set(groups.flat());
      const joined = [...next].filter(id => !prior.has(id));
      const left = [...prior].filter(id => !next.has(id));
      prior = next;
      return { groups, joined, left, lockedGroups: [...lockedGroups.values()].filter(group => valid.has(groupKey(group))) };
    },
  };
}
