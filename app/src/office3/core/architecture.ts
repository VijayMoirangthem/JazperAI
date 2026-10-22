export interface WallSegment { from: number; to: number; }
export const splitWallForDoor = (length: number, doorAt: number, doorWidth = 2): WallSegment[] => {
  const start = Math.max(0, doorAt - doorWidth / 2), end = Math.min(length, doorAt + doorWidth / 2);
  return [{ from: 0, to: start }, { from: end, to: length }].filter(segment => segment.to > segment.from);
};
export const roomSeatCount = (width: number, depth: number): number => Math.max(0, Math.floor((width - 2) / 2) * 2 + Math.floor((depth - 2) / 2) * 2);
