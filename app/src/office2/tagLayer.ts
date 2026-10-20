import Phaser from "phaser";
import { isAttention } from "./behavior.ts";
import { DEPTH } from "./constants.ts";
import type { AvatarLayer } from "./avatars.ts";
import { layoutTags, tagVisible } from "./nameTags.ts";

interface Tag { text: Phaser.GameObjects.Text; off: number }

/** One name tag per avatar. Constant size on screen (scale 1/zoom), collision-free via layoutTags (re-laid out 5x/s), glued to the avatar every frame. */
export class TagLayer {
  private readonly tags = new Map<string, Tag>();
  private readonly lines: Phaser.GameObjects.Graphics;
  private readonly scene: Phaser.Scene;
  private readonly layer: AvatarLayer;

  constructor(scene: Phaser.Scene, layer: AvatarLayer) {
    this.scene = scene;
    this.layer = layer;
    this.lines = scene.add.graphics().setDepth(DEPTH.tags - 1);
    scene.time.addEvent({ delay: 200, loop: true, callback: () => this.relayout() });
  }

  private visible(slug: string): boolean {
    const a = this.layer.avatars.get(slug)!;
    return tagVisible(this.scene.cameras.main.zoom, {
      hovered: this.layer.hovered === slug, selected: this.layer.selected === slug, founder: a.person.kind === "human", state: a.state,
    });
  }

  private ensure(): void {
    for (const [slug, t] of this.tags) if (!this.layer.avatars.has(slug)) { t.text.destroy(); this.tags.delete(slug); }
    for (const [slug, a] of this.layer.avatars) {
      if (this.tags.has(slug)) continue;
      const text = this.scene.add.text(0, 0, a.person.name.split(" ")[0], {
        fontSize: "10px", color: "#f8fafc", backgroundColor: "rgba(15,23,42,0.85)", padding: { x: 3, y: 1 }, fontFamily: "system-ui, sans-serif",
      }).setOrigin(0.5, 0).setDepth(DEPTH.tags).setResolution(2);
      this.tags.set(slug, { text, off: 0 });
    }
  }

  private anchorY(slug: string, h: number, s: number): number {
    return this.layer.avatars.get(slug)!.sprite.y - 40 * s - h;
  }

  relayout(): void {
    this.ensure();
    const s = 1 / this.scene.cameras.main.zoom;
    const items = [];
    for (const [slug, t] of this.tags) {
      if (!this.visible(slug)) { t.off = 0; continue; }
      const a = this.layer.avatars.get(slug)!;
      const h = t.text.height * s;
      const pri = a.person.kind === "human" ? 3 : isAttention(a.state) || this.layer.selected === slug ? 2 : 0;
      items.push({ id: slug, x: a.sprite.x, y: this.anchorY(slug, h, s), w: t.text.width * s, h, priority: pri });
    }
    for (const p of layoutTags(items, 2 * s)) this.tags.get(p.id)!.off = p.y - items.find((i) => i.id === p.id)!.y;
  }

  update(): void {
    this.ensure();
    const s = 1 / this.scene.cameras.main.zoom;
    this.lines.clear().lineStyle(1 * s, 0x94a3b8, 0.7);
    for (const [slug, t] of this.tags) {
      const vis = this.visible(slug);
      t.text.setVisible(vis);
      if (!vis) continue;
      const a = this.layer.avatars.get(slug)!;
      const h = t.text.height * s;
      t.text.setScale(s).setPosition(a.sprite.x, this.anchorY(slug, h, s) + t.off);
      if (t.off < -6 * s) this.lines.lineBetween(a.sprite.x, t.text.y + h, a.sprite.x, a.sprite.y - 34 * s);
    }
  }

  snapshot(): { slug: string; x: number; y: number; w: number; h: number; visible: boolean }[] {
    const s = 1 / this.scene.cameras.main.zoom;
    return [...this.tags].map(([slug, t]) => ({ slug, x: t.text.x, y: t.text.y, w: t.text.width * s, h: t.text.height * s, visible: t.text.visible }));
  }
}
