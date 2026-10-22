import type { Facing, Rect, RoomKind } from "./world.ts";

export type RoomTemplateId = "meeting-8" | "lounge" | "open-desks" | "server-room" | "kitchenette" | "phone-booth";
export interface TemplateRoom { id: string; kind: RoomKind; rect: Rect; }
export interface TemplateObject { prefab: string; pos: [number, number]; rot: number; }
export interface TemplateSeat { pos: [number, number]; facing: Facing; }
export interface RoomTemplateResult { objects: TemplateObject[]; seats: TemplateSeat[]; }

const inside = (room: TemplateRoom, x: number, y: number) => x >= room.rect[0] && x <= room.rect[2] && y >= room.rect[1] && y <= room.rect[3];
const addObject = (result: RoomTemplateResult, room: TemplateRoom, prefab: string, x: number, y: number, rot = 0) => {
  if (inside(room, x, y)) result.objects.push({ prefab, pos: [x, y], rot });
};
const addSeat = (result: RoomTemplateResult, room: TemplateRoom, x: number, y: number, facing: Facing) => {
  if (inside(room, x, y)) result.seats.push({ pos: [x, y], facing });
};

const TEMPLATE_BY_KIND: Record<RoomKind, RoomTemplateId> = { meet: "meeting-8", social: "lounge", work: "open-desks", tools: "server-room", private: "phone-booth", transit: "kitchenette" };
export const templateForRoomKind = (kind: RoomKind): RoomTemplateId => TEMPLATE_BY_KIND[kind];

export const instantiateRoomTemplate = (id: RoomTemplateId, room: TemplateRoom): RoomTemplateResult => {
  const [left, top, right, bottom] = room.rect;
  const result: RoomTemplateResult = { objects: [], seats: [] };
  const centerX = Math.floor((left + right) / 2), centerY = Math.floor((top + bottom) / 2);
  if (id === "meeting-8") {
    addObject(result, room, "conference-table-v1", centerX, centerY);
    for (let x = centerX - 2; x <= centerX + 2; x += 2) { addSeat(result, room, x, Math.max(top + 1, centerY - 2), "down"); addSeat(result, room, x, Math.min(bottom - 1, centerY + 2), "up"); }
    addSeat(result, room, Math.max(left + 1, centerX - 3), centerY, "right"); addSeat(result, room, Math.min(right - 1, centerX + 3), centerY, "left");
  } else if (id === "open-desks") {
    for (let y = top + 1; y < bottom; y += 2) for (let x = left + 1; x < right; x += 2) { addObject(result, room, "workstation-v1", x, y); addSeat(result, room, x, Math.min(bottom - 1, y + 1), "up"); }
  } else if (id === "lounge") {
    addObject(result, room, "sofa-v1", Math.max(left + 1, centerX - 2), centerY, 0); addObject(result, room, "sofa-v1", Math.min(right - 1, centerX + 2), centerY, Math.PI); addObject(result, room, "ficus-v1", left + 1, top + 1);
    addSeat(result, room, Math.max(left + 1, centerX - 1), centerY, "right"); addSeat(result, room, Math.min(right - 1, centerX + 1), centerY, "left");
  } else if (id === "server-room") {
    for (let y = top + 1; y < bottom; y += 2) addObject(result, room, "tech-server-rack-v1", left + 1, y);
    addObject(result, room, "tech-hardware-bench-v1", Math.min(right - 1, left + 3), centerY); addSeat(result, room, Math.min(right - 1, left + 3), Math.min(bottom - 1, centerY + 1), "up");
  } else if (id === "kitchenette") {
    addObject(result, room, "counter-v1", centerX, top + 1); addObject(result, room, "ficus-v1", right - 1, bottom - 1);
  } else {
    addObject(result, room, "counter-v1", centerX, centerY); addSeat(result, room, centerX, Math.min(bottom - 1, centerY + 1), "up");
  }
  return result;
};
