export type MotionState = "idle" | "working" | "planning" | "waiting_human" | "waiting_tool" | "walk";
const seedValue = (seed: string): number => [...seed].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 17);
export const idlePeriod = (seed: string): number => 4 + seedValue(seed) % 6;
export const idleVariant = (seed: string, nowSeconds: number): "weight-shift" | "look" | "stretch" => (["weight-shift", "look", "stretch"] as const)[(seedValue(seed) + Math.floor(nowSeconds / idlePeriod(seed))) % 3];
export const motionForState = (state: MotionState): string => ({ idle: "idle", working: "typing", planning: "reading", waiting_human: "hand-raise", waiting_tool: "pace", walk: "walk" })[state];
export const needsTurnBeforeWalk = (fromYaw: number, toYaw: number): boolean => Math.abs((((toYaw - fromYaw + Math.PI) % (Math.PI * 2)) - Math.PI)) > Math.PI / 3;
