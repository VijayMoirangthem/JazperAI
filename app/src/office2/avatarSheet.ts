import type Phaser from "phaser";
import { lookKey } from "./look.ts";
import type { Look } from "./types.ts";

export type Dir = "down" | "left" | "right" | "up";
export const DIRS: readonly Dir[] = ["down", "left", "right", "up"];
export const DIR_ROW: Record<Dir, number> = { down: 0, left: 1, right: 2, up: 3 };
export const FRAME = 32;

/** Layer parts copied from WorkAdventure (see docs/virtualOffice/COPIED_FROM_WORKADVENTURE.md). Drawn bottom to top in this order. */
export type WokaManifest = Record<"body" | "eyes" | "hair" | "clothes" | "hat" | "accessory", string[]>;
const ORDER = ["body", "eyes", "hair", "clothes", "hat", "accessory"] as const;
const layerKey = (cat: string, file: string) => `woka:${cat}:${file}`;

/** Queue every layer image for loading (call from the scene's loader once the manifest JSON has arrived). */
export function queueWoka(scene: Phaser.Scene, m: WokaManifest): void {
  for (const cat of ORDER) for (const f of m[cat]) scene.load.image(layerKey(cat, f), `/office2/woka/${cat}/${f}`);
}

const manifestOf = (scene: Phaser.Scene) => scene.cache.json.get("woka-manifest") as WokaManifest;

/** Composes the layers of a look into one 96x128 canvas (3 columns x 4 rows: down, left, right, up). The clothes get a light crew-colour tint. */
export function composeSheet(scene: Phaser.Scene, look: Look): HTMLCanvasElement {
  const m = manifestOf(scene);
  const canvas = document.createElement("canvas");
  canvas.width = FRAME * 3; canvas.height = FRAME * 4;
  const ctx = canvas.getContext("2d")!;
  for (const cat of ORDER) {
    const i = look[cat];
    const file = i >= 0 ? m[cat][i] : undefined;
    if (!file) continue;
    const img = scene.textures.get(layerKey(cat, file)).getSourceImage() as CanvasImageSource;
    if (cat !== "clothes") { ctx.drawImage(img, 0, 0); continue; }
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width; tmp.height = canvas.height;
    const t = tmp.getContext("2d")!;
    t.drawImage(img, 0, 0);
    t.globalCompositeOperation = "source-atop";
    t.globalAlpha = 0.4; t.fillStyle = look.shirtColor; t.fillRect(0, 0, tmp.width, tmp.height);
    ctx.drawImage(tmp, 0, 0);
  }
  return canvas;
}

/** Texture key for a look. Same look -> same key, so equal looks share one texture. */
export const avatarKey = (look: Look): string => `av:${lookKey(look)}`;

/** Registers (once per look) a texture with 12 frames and the animations `<key>:walk:<dir>` (frames 0,1,2,1 at 8 fps) and `<key>:idle:<dir>`. Returns the key. */
export function ensureAvatar(scene: Phaser.Scene, look: Look): string {
  const key = avatarKey(look);
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.addCanvas(key, composeSheet(scene, look))!;
  for (let f = 0; f < 12; f++) tex.add(f, 0, (f % 3) * FRAME, Math.floor(f / 3) * FRAME, FRAME, FRAME);
  for (const dir of DIRS) {
    const row = DIR_ROW[dir] * 3;
    scene.anims.create({ key: `${key}:walk:${dir}`, frames: [0, 1, 2, 1].map((i) => ({ key, frame: row + i })), frameRate: 8, repeat: -1 });
    scene.anims.create({ key: `${key}:idle:${dir}`, frames: [{ key, frame: row + 1 }], frameRate: 1 });
  }
  return key;
}

/** Standing front view as a data URL (ID card, dialogs), scaled up without smoothing. */
export function portraitUrl(scene: Phaser.Scene, look: Look, scale = 6): string {
  const sheet = composeSheet(scene, look);
  const out = document.createElement("canvas");
  out.width = FRAME * scale; out.height = FRAME * scale;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, FRAME, 0, FRAME, FRAME, 0, 0, out.width, out.height);
  return out.toDataURL();
}
