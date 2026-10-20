import Phaser from "phaser";
import { avatarKey, ensureAvatar, type Dir } from "./avatarSheet.ts";
import { ringColor } from "./behavior.ts";
import { T } from "./constants.ts";
import { lookFor } from "./look.ts";
import { nearestFree } from "./pathfind.ts";
import { planSeats } from "./people.ts";
import type { Look, MapModel, Person, Place, Pt, Spot } from "./types.ts";

export interface Avatar {
  person: Person; look: Look; key: string;
  sprite: Phaser.GameObjects.Sprite; ring: Phaser.GameObjects.Ellipse;
  tile: Pt; home: Spot; state: string; place: Place; walking: boolean; facing: Dir;
}

/** Owns one sprite + state ring per person. sync() diffs the list; existing avatars are never rebuilt. */
export class AvatarLayer {
  readonly avatars = new Map<string, Avatar>();
  hovered: string | null = null;
  selected: string | null = null;
  private readonly scene: Phaser.Scene;
  private readonly model: MapModel;

  constructor(scene: Phaser.Scene, model: MapModel) {
    this.scene = scene;
    this.model = model;
  }

  /** World pixel position of the feet for a tile. */
  static feet(tx: number, ty: number): [number, number] { return [tx * T + T / 2, ty * T + 28]; }

  sync(people: readonly Person[], overrides: Record<string, Partial<Look>>, gatherRoom?: string): void {
    const want = new Set(people.map((p) => p.slug));
    for (const [slug, a] of this.avatars) if (!want.has(slug)) { a.sprite.destroy(); a.ring.destroy(); this.avatars.delete(slug); }
    const plan = planSeats(people, this.model.spots);
    const taken = new Set<string>();
    const area = gatherRoom ? this.model.areas.find((a) => a.room === gatherRoom) : undefined;
    for (const p of people) {
      const look = lookFor(p.slug, p.crew, p.kind, overrides[p.slug]);
      const key = ensureAvatar(this.scene, look);
      const cur = this.avatars.get(p.slug);
      if (cur) {
        cur.person = p;
        if (cur.key !== key) { cur.key = key; cur.look = look; cur.sprite.setTexture(key, 1); cur.sprite.play(`${key}:idle:${cur.facing}`); }
        continue;
      }
      const home = plan.get(p.slug)!;
      let tile: Pt = [home.x, home.y];
      if (area) tile = nearestFree(this.model.blocked, [area.x + (area.w >> 1), area.y + (area.h >> 1)], taken) ?? tile;
      taken.add(`${tile[0]},${tile[1]}`);
      this.add(p, look, key, home, tile);
    }
  }

  private add(person: Person, look: Look, key: string, home: Spot, tile: Pt): void {
    const [x, y] = AvatarLayer.feet(tile[0], tile[1]);
    const ring = this.scene.add.ellipse(x, y - 2, 20, 9, ringColor("idle"), 0.9).setDepth(y - 1);
    const sprite = this.scene.add.sprite(x, y, key, 1).setOrigin(0.5, 0.9).setDepth(y).setInteractive({ useHandCursor: true });
    sprite.play(`${key}:idle:down`);
    const slug = person.slug;
    sprite.on("pointerdown", () => this.scene.events.emit("avatar-select", slug));
    sprite.on("pointerover", () => { this.hovered = slug; });
    sprite.on("pointerout", () => { if (this.hovered === slug) this.hovered = null; });
    this.avatars.set(slug, { person, look, key, sprite, ring, tile, home, state: "idle", place: "desk", walking: false, facing: "down" });
  }

  setState(slug: string, state: string): void {
    const a = this.avatars.get(slug);
    if (!a || a.state === state) return;
    a.state = state;
    a.ring.setFillStyle(ringColor(state), 0.9);
    a.sprite.setAlpha(state === "deprecated" ? 0.5 : 1);
  }

  select(slug: string | null): void {
    this.selected = slug;
    for (const a of this.avatars.values()) a.ring.setStrokeStyle(a.person.slug === slug ? 2 : 0, 0xffffff, 1);
  }

  /** Move an avatar's sprite and ring to a world position (feet) and keep depth in sync. */
  setPosition(a: Avatar, x: number, y: number): void {
    a.sprite.setPosition(x, y).setDepth(y);
    a.ring.setPosition(x, y - 2).setDepth(y - 1);
  }
}
export { avatarKey };
