export interface PositionMessage { type: "move"; x: number; z: number; facing: number; anim: string; seq: number; }

export const encodePosition = (message: PositionMessage): string => JSON.stringify(message);

export const decodePosition = (raw: string): PositionMessage | null => {
  try {
    const value = JSON.parse(raw) as Partial<PositionMessage>;
    if (value.type !== "move" || !Number.isFinite(value.x) || !Number.isFinite(value.z) || !Number.isFinite(value.facing) || !Number.isInteger(value.seq) || typeof value.anim !== "string") return null;
    return value as PositionMessage;
  } catch { return null; }
};

export const validMove = (previous: readonly [number, number], next: readonly [number, number], elapsedSeconds: number, speed = 6): boolean => elapsedSeconds > 0 && Math.hypot(next[0] - previous[0], next[1] - previous[1]) <= speed * elapsedSeconds + 0.01;

export const interestCell = (x: number, z: number, size = 16): [number, number] => [Math.floor(x / size), Math.floor(z / size)];
export const sharesInterest = (viewer: readonly [number, number], subject: readonly [number, number], radius = 1): boolean => Math.abs(viewer[0] - subject[0]) <= radius && Math.abs(viewer[1] - subject[1]) <= radius;
