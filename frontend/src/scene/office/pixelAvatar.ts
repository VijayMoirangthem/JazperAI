// Deterministic procedural pixel avatar — no sprite sheets, no external art.
// Renders a 16x24 humanoid in a palette derived from badge_color + seed.

export function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map(c => c + c).join("") : m;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
}

export const AVATAR_W = 16;
export const AVATAR_H = 24;

/** Build a pixel avatar canvas from a seed + accent color. */
export function pixelAvatar(seed: string, accent: string, scale = 4): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_W;
  canvas.height = AVATAR_H;
  const ctx = canvas.getContext("2d")!;
  const rnd = mulberry32(hashSeed(seed || "anon"));

  const skin = ["#f2c9a0", "#e0ac69", "#c68642", "#8d5524", "#ffdbb5"][Math.floor(rnd() * 5)];
  const shirt = mix(accent, "#000000", 0.15);
  const shirtDark = mix(accent, "#000000", 0.45);
  const pants = "#2f3542";
  const shoe = "#1c1e26";
  const hair = ["#1b1b1b", "#4a3728", "#6b4f2f", "#3a3a3a", "#7a5230"][Math.floor(rnd() * 5)];
  const eye = "#1a1a1a";

  const px = (x: number, y: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 1, 1);
  };

  // hair
  for (let x = 5; x <= 10; x++) for (let y = 1; y <= 5; y++) px(x, y, hair);
  for (let x = 6; x <= 9; x++) px(x, 6, hair);

  // head
  for (let x = 5; x <= 10; x++) for (let y = 6; y <= 10; y++) px(x, y, skin);
  // eyes
  px(6, 8, eye); px(9, 8, eye);
  // mouth
  px(7, 10, "#b05050");

  // body / shirt
  for (let x = 5; x <= 10; x++) for (let y = 12; y <= 16; y++) px(x, y, shirt);
  // arms
  for (let y = 12; y <= 15; y++) { px(4, y, shirtDark); px(11, y, shirtDark); }
  // hands
  px(4, 16, skin); px(11, 16, skin);

  // pants
  for (let x = 6; x <= 9; x++) for (let y = 17; y <= 19; y++) px(x, y, pants);
  // shoes
  for (let x = 6; x <= 9; x++) { px(x, 20, shoe); px(x, 21, shoe); }
  px(5, 21, shoe); px(10, 21, shoe);

  // subtle outline for contrast against bright floors
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(5, 5, 1, 1); ctx.fillRect(10, 5, 1, 1);
  ctx.fillRect(4, 11, 1, 1); ctx.fillRect(11, 11, 1, 1);

  const scaled = document.createElement("canvas");
  scaled.width = AVATAR_W * scale;
  scaled.height = AVATAR_H * scale;
  const sctx = scaled.getContext("2d")!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(canvas, 0, 0, AVATAR_W, AVATAR_H, 0, 0, AVATAR_W * scale, AVATAR_H * scale);
  return scaled;
}