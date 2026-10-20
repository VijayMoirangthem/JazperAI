/** Shared shapes for the Office 2 modules. Types only: this file has no runtime code. */
export type Pt = readonly [number, number];
export type Facing = "up" | "down" | "left" | "right";
export type Place = "desk" | "meeting" | "tools" | "lounge" | "founder";

export interface Area {
  room: string; label: string; kind: string;
  x: number; y: number; w: number; h: number; // tile units
  silent: boolean; focusable: boolean; capacity: number;
}
export interface Spot { type: "seat" | "spot"; room: string; slot: number; x: number; y: number; facing?: Facing; owner?: string }
export interface MapModel {
  width: number; height: number; tile: number;
  blocked: boolean[][]; // blocked[y][x]
  areas: Area[]; spots: Spot[];
  start: Pt;
  roomAt(x: number, y: number): string | null;
}

/** Indices into app/public/office2/woka/manifest.json lists. hat and accessory use -1 for none. */
export interface Look { body: number; eyes: number; hair: number; clothes: number; hat: number; accessory: number; shirtColor: string }

export interface Person { slug: string; name: string; role: string; crew: string; kind: "human" | "bot"; lifecycle?: string }
