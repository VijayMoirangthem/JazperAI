import { assignSpot } from "./behavior.ts";
import type { Person, Spot } from "./types.ts";

export interface DirectoryLike { humans?: { id: string; display_name: string }[] }
export interface RosterLike { bots?: { slug: string; display_name: string; role_title: string; crew: string; lifecycle?: string; enabled: boolean }[] }

export const OPS_CREWS: ReadonlySet<string> = new Set(["personal", "boardmint", "people", "sre", "l1", "human", "exec"]);

/** Humans first (as given), then enabled bots sorted by slug. */
export function toPeople(dir: DirectoryLike | undefined, roster: RosterLike | undefined): Person[] {
  const humans: Person[] = (dir?.humans ?? []).map((h) => ({ slug: h.id, name: h.display_name, role: "Founder", crew: "human", kind: "human" as const }));
  const bots: Person[] = (roster?.bots ?? []).filter((b) => b.enabled).map((b) => ({ slug: b.slug, name: b.display_name, role: b.role_title, crew: b.crew, kind: "bot" as const, lifecycle: b.lifecycle }))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return [...humans, ...bots];
}

export const peopleSignature = (p: readonly Person[]): string => JSON.stringify(p.map((x) => [x.slug, x.name, x.role, x.crew, x.kind, x.lifecycle ?? ""]));

export function homeRoom(p: Person): "engineering" | "operations" | "founder" {
  if (p.kind === "human") return "founder";
  return OPS_CREWS.has(p.crew) ? "operations" : "engineering";
}

const OVERFLOW_ROOMS = ["lounge", "reception", "server", "corridor"] as const;

/** One home spot per person. Humans -> founder room seat; bots -> a desk seat in their home room, then the other work room, then standing spots (lounge, reception, server, corridor). Tiles are distinct while spots last. */
export function planSeats(people: readonly Person[], spots: readonly Spot[]): Map<string, Spot> {
  const out = new Map<string, Spot>();
  const taken = new Set<string>();
  const key = (s: Spot) => `${s.x},${s.y}`;
  const inRoom = (room: string, type?: "seat" | "spot") => spots.filter((s) => s.room === room && (!type || s.type === type)).sort((a, b) => a.slot - b.slot);
  const claim = (p: Person, list: Spot[]): boolean => {
    const s = assignSpot(list, taken, p.slug);
    if (!s) return false;
    taken.add(key(s)); out.set(p.slug, s);
    return true;
  };
  for (const p of people) {
    const home = homeRoom(p);
    const other = home === "engineering" ? "operations" : "engineering";
    if (home === "founder") { if (claim(p, inRoom("founder", "seat")) || claim(p, inRoom("founder"))) continue; }
    else if (claim(p, inRoom(home, "seat")) || claim(p, inRoom(other, "seat"))) continue;
    if (OVERFLOW_ROOMS.some((r) => claim(p, inRoom(r)))) continue;
    const any = inRoom("corridor"); // everything is taken: share a corridor spot (stable by slug)
    out.set(p.slug, any[Math.abs(p.slug.length * 31 + p.slug.charCodeAt(0)) % any.length]);
  }
  return out;
}

const SIM_CREWS = ["it", "baeit", "rnd", "sre", "personal", "boardmint", "people", "coreops"];
export function makeSimPeople(n: number): Person[] {
  return Array.from({ length: n }, (_, i) => ({ slug: `sim-${String(i + 1).padStart(2, "0")}`, name: `Sim ${i + 1}`, role: "Simulated agent", crew: SIM_CREWS[i % SIM_CREWS.length], kind: "bot" as const, lifecycle: "active" }));
}
