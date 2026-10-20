import Phaser from "phaser";
import type { AvatarLayer } from "./avatars.ts";
import { DEPTH, T } from "./constants.ts";
import { createProximity } from "./proximity.ts";
import type { MapModel } from "./types.ts";

/** Proximity groups: soft halo + link lines per group, recomputed 4x/s. Calls onFounder when the founder's neighbours change. */
export class Halos {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly prox = createProximity({ enter: 2, leave: 3 });
  private current: string[][] = [];
  private founderKey = "";

  private readonly layer: AvatarLayer;
  private readonly model: MapModel;
  private readonly onFounder: (others: string[]) => void;

  constructor(scene: Phaser.Scene, layer: AvatarLayer, model: MapModel, onFounder: (others: string[]) => void) {
    this.layer = layer; this.model = model; this.onFounder = onFounder;
    this.g = scene.add.graphics().setDepth(DEPTH.halo);
    scene.time.addEvent({ delay: 250, loop: true, callback: () => this.tick() });
  }

  groups(): string[][] { return this.current; }

  private tick(): void {
    const people = [...this.layer.avatars.values()].map((a) => {
      const tile: [number, number] = [Math.floor(a.sprite.x / T), Math.floor(a.sprite.y / T)];
      const room = this.model.roomAt(tile[0], tile[1]);
      return { id: a.person.slug, tile, walking: a.walking, silent: this.model.areas.some((r) => r.room === room && r.silent) };
    });
    this.current = this.prox.update(people).groups;
    this.g.clear();
    for (const grp of this.current) {
      const av = grp.map((id) => this.layer.avatars.get(id)!.sprite);
      const cx = av.reduce((s, a) => s + a.x, 0) / av.length, cy = av.reduce((s, a) => s + a.y, 0) / av.length;
      const r = Math.max(...av.map((a) => Math.hypot(a.x - cx, a.y - cy))) + 28;
      this.g.fillStyle(0x60a5fa, 0.12).fillCircle(cx, cy - 10, r);
      this.g.lineStyle(1, 0x60a5fa, 0.5);
      for (let i = 0; i < av.length; i++) for (let j = i + 1; j < av.length; j++) this.g.lineBetween(av[i].x, av[i].y - 10, av[j].x, av[j].y - 10);
    }
    const f = [...this.layer.avatars.values()].find((a) => a.person.kind === "human");
    const mine = f ? (this.current.find((grp) => grp.includes(f.person.slug)) ?? []).filter((id) => id !== f.person.slug) : [];
    const key = mine.join(",");
    if (key !== this.founderKey) { this.founderKey = key; this.onFounder(mine); }
  }
}
