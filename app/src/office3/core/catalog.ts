export interface PrefabRecord {
  id: string; name: string; category: string; tags: string[]; file: string | null;
  footprint: [number, number]; height: number; anchor: [number, number, number];
  rotSteps: 4; snap: "grid" | "wall" | "free"; blocks: boolean; placeholder?: boolean;
}
export const rotatedFootprint = (footprint: readonly [number, number], turns: number): [number, number] => turns % 2 ? [footprint[1], footprint[0]] : [footprint[0], footprint[1]];
export const validPrefab = (prefab: PrefabRecord): boolean => Boolean(prefab.id && prefab.category && prefab.footprint[0] > 0 && prefab.footprint[1] > 0 && prefab.rotSteps === 4);
