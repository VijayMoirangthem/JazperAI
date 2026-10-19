/** Procedural pixel-art characters: 12x16 logical pixels, 4 directions x 2 walk frames, palette derived from the slug. */
export const CREW_COLOR: Record<string, string> = {
  l1: "#a855f7", coreops: "#38bdf8", it: "#22c55e", baeit: "#f97316", boardmint: "#eab308", rnd: "#ec4899",
  people: "#14b8a6", sre: "#ef4444", personal: "#60a5fa", unmapped: "#94a3b8", human: "#fbbf24",
};
const SKIN = ["#f1c9a5", "#e0a97c", "#c68a5b", "#a46a3f", "#7b4a2a"];
const HAIR = ["#1f1a17", "#4b2e1b", "#7a4a21", "#c2873c", "#d9d4cf", "#3b2f6b"];

export const hash = (s: string): number => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
export const DIRS = ["down", "up", "left", "right"] as const;
export const FRAME_W = 12, FRAME_H = 16;

/** Draws frame (dir, step) at (ox, 0). step 0/1 alternates legs and arm swing. */
export function drawFrame(ctx: CanvasRenderingContext2D, ox: number, slug: string, crew: string, dir: number, step: number): void {
  const h = hash(slug), skin = SKIN[h % SKIN.length], hair = HAIR[(h >> 4) % HAIR.length], shirt = CREW_COLOR[crew] ?? CREW_COLOR.unmapped;
  const px = (x: number, y: number, w: number, hh: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(ox + x, y, w, hh); };
  const bob = step ? 1 : 0;
  px(3, 14, 6, 1, "rgba(0,0,0,0.25)"); // shadow
  // legs
  px(4, 11 + bob * 0, 2, 4 - (step ? 1 : 0), "#26324a"); px(6, 11, 2, 4 - (step ? 0 : 1), "#26324a");
  px(4, 14 - (step ? 1 : 0), 2, 1, "#111827"); px(6, 14 - (step ? 0 : 1), 2, 1, "#111827");
  // torso + arms
  px(3, 6, 6, 5, shirt);
  const swing = dir > 1 ? 0 : step ? 1 : -1;
  px(2, 7 + (swing > 0 ? 1 : 0), 1, 3, skin); px(9, 7 + (swing < 0 ? 1 : 0), 1, 3, skin);
  // head
  px(3, 1, 6, 5, skin);
  if (dir === 1) px(3, 1, 6, 4, hair); // back of head
  else { px(3, 1, 6, 2, hair); if (dir === 0) { px(4, 3, 1, 1, "#111827"); px(7, 3, 1, 1, "#111827"); } else px(dir === 2 ? 4 : 7, 3, 1, 1, "#111827"); }
  if (dir === 2) px(8, 1, 1, 3, hair); if (dir === 3) px(3, 1, 1, 3, hair);
}

/** Draws the whole 8-frame strip onto `canvas` (width FRAME_W*8). Frame index = dir*2 + step. */
export function drawStrip(canvas: HTMLCanvasElement, slug: string, crew: string): void {
  canvas.width = FRAME_W * 8; canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let d = 0; d < 4; d++) for (let s = 0; s < 2; s++) drawFrame(ctx, (d * 2 + s) * FRAME_W, slug, crew, d, s);
}

/** Standing portrait as a data URL (for ID cards), scaled up crisp. */
export function portrait(slug: string, crew: string, scale = 8): string {
  const strip = document.createElement("canvas");
  drawStrip(strip, slug, crew);
  const out = document.createElement("canvas");
  out.width = FRAME_W * scale; out.height = FRAME_H * scale;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(strip, 0, 0, FRAME_W, FRAME_H, 0, 0, out.width, out.height);
  return out.toDataURL();
}
