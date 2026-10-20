import { hash } from "./hash.ts";
import type { Look } from "./types.ts";

export const CREW_COLOR: Record<string, string> = {
  l1: "#a855f7", coreops: "#38bdf8", it: "#22c55e", baeit: "#f97316", boardmint: "#eab308", rnd: "#ec4899",
  people: "#14b8a6", sre: "#ef4444", personal: "#60a5fa", exec: "#d946ef", unmapped: "#94a3b8", human: "#fbbf24",
};
/** Number of parts per layer in app/public/office2/woka/manifest.json (checked by the look test). */
export const LOOK_COUNTS = { body: 33, eyes: 30, hair: 74, clothes: 74, hat: 27, accessory: 34 } as const;
type Slot = keyof typeof LOOK_COUNTS;
const OPTIONAL: readonly Slot[] = ["hat", "accessory"]; // -1 = none

const pick = (slug: string, slot: string, n: number) => hash(`${slug}:${slot}`) % n;
const maybe = (slug: string, slot: Slot, chance: number) => (pick(slug, slot + "?", 100) < chance ? pick(slug, slot, LOOK_COUNTS[slot]) : -1);

export function lookFor(slug: string, crew: string, kind: "human" | "bot", override?: Partial<Look>): Look {
  const base: Look = {
    body: pick(slug, "body", LOOK_COUNTS.body), eyes: pick(slug, "eyes", LOOK_COUNTS.eyes),
    hair: pick(slug, "hair", LOOK_COUNTS.hair), clothes: pick(slug, "clothes", LOOK_COUNTS.clothes),
    hat: kind === "human" ? -1 : maybe(slug, "hat", 20), accessory: kind === "human" ? -1 : maybe(slug, "accessory", 25),
    shirtColor: CREW_COLOR[crew] ?? CREW_COLOR.unmapped,
  };
  if (!override) return base;
  const out = { ...base };
  for (const k of Object.keys(LOOK_COUNTS) as Slot[]) {
    const v = override[k];
    const min = OPTIONAL.includes(k) ? -1 : 0;
    if (typeof v === "number" && Number.isInteger(v) && v >= min && v < LOOK_COUNTS[k]) out[k] = v;
  }
  if (typeof override.shirtColor === "string" && /^#[0-9a-fA-F]{6}$/.test(override.shirtColor)) out.shirtColor = override.shirtColor;
  return out;
}

export const lookKey = (l: Look): string => `${l.body}.${l.eyes}.${l.hair}.${l.clothes}.${l.hat}.${l.accessory}.${l.shirtColor.slice(1)}`;
