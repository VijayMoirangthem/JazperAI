import { parseWorld, type World } from "./world.ts";

const MAX_WORLD_BYTES = 2 * 1024 * 1024;
export const exportWorld = (world: World): string => JSON.stringify(world);
export const importWorld = (raw: string): World => {
  if (new TextEncoder().encode(raw).byteLength > MAX_WORLD_BYTES) throw Error("world import exceeds 2 MB");
  return parseWorld(JSON.parse(raw));
};
export const cloneWorld = (world: World, id: string, name: string): World => ({ ...structuredClone(world), id, name });
