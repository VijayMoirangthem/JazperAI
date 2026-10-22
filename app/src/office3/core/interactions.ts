export type InteractionId = "coffee" | "printer" | "whiteboard" | "vending" | "water" | "sofa" | "server" | "booth" | "reception";
export interface Interactable { id: InteractionId; prefab: string; cooldownMs: number; agentsOnly?: boolean }
export interface InteractionTarget { id: string; prefab: string; pos: readonly [number, number] }
export const INTERACTIONS: readonly Interactable[] = [{id:"coffee",prefab:"counter-v1",cooldownMs:3000},{id:"printer",prefab:"low-shelf-v1",cooldownMs:2000},{id:"whiteboard",prefab:"conference-table-v1",cooldownMs:1000},{id:"vending",prefab:"counter-v1",cooldownMs:3000},{id:"water",prefab:"counter-v1",cooldownMs:2000},{id:"sofa",prefab:"sofa-v1",cooldownMs:0},{id:"server",prefab:"tech-server-rack-v1",cooldownMs:1000},{id:"booth",prefab:"tech-hardware-bench-v1",cooldownMs:1000},{id:"reception",prefab:"counter-v1",cooldownMs:1000}];
export const interactionForPrefab = (prefab: string): Interactable | undefined => INTERACTIONS.find(item => item.prefab === prefab);
export const canUseInteraction = (item: Interactable, lastUsed: number, now: number, isAgent: boolean): boolean => (!item.agentsOnly || isAgent) && now - lastUsed >= item.cooldownMs;
export const nearestInteraction = (targets: readonly InteractionTarget[], at: readonly [number, number], radius = 2): { target: InteractionTarget; interaction: Interactable } | undefined => {
 let best: { target: InteractionTarget; interaction: Interactable; distance: number } | undefined;
 for (const target of targets) { const interaction = interactionForPrefab(target.prefab); const distance = Math.hypot(target.pos[0] - at[0], target.pos[1] - at[1]); if (interaction && distance <= radius && (!best || distance < best.distance)) best = { target, interaction, distance }; }
 return best;
};
export const interactionMessage = (id: InteractionId): string => ({ coffee: "Taking a coffee", printer: "Checking the printer", whiteboard: "Reviewing the board", vending: "Getting a snack", water: "At the water cooler", sofa: "Taking a seat", server: "Checking servers", booth: "Using the booth", reception: "Welcome!" })[id];
