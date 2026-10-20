import Phaser from "phaser";
import { DEPTH } from "./constants.ts";
import type { AvatarLayer } from "./avatars.ts";

interface Bubble { text: Phaser.GameObjects.Text; label: string; until: number | null }

/** Status bubbles glued to their avatar: position is recomputed from the avatar every frame. */
export class BubbleLayer {
  private readonly bubbles = new Map<string, Bubble>();
  private readonly scene: Phaser.Scene;
  private readonly layer: AvatarLayer;

  constructor(scene: Phaser.Scene, layer: AvatarLayer) {
    this.scene = scene;
    this.layer = layer;
  }

  /** ttlMs null = stay until hide() */
  show(slug: string, raw: string, ttlMs: number | null): void {
    const label = raw.length > 40 ? raw.slice(0, 40) + "…" : raw;
    let b = this.bubbles.get(slug);
    if (!b) {
      const text = this.scene.add.text(0, 0, "", {
        fontSize: "10px", color: "#0f172a", backgroundColor: "#e2e8f0", padding: { x: 4, y: 2 }, fontFamily: "system-ui, sans-serif",
      }).setOrigin(0.5, 1).setDepth(DEPTH.tags + 1).setResolution(2);
      b = { text, label: "", until: null };
      this.bubbles.set(slug, b);
    }
    if (b.label !== label) { b.label = label; b.text.setText(label); }
    b.until = ttlMs === null ? null : this.scene.time.now + ttlMs;
    b.text.setVisible(true);
  }

  hide(slug: string): void {
    const b = this.bubbles.get(slug);
    if (b) { b.text.destroy(); this.bubbles.delete(slug); }
  }

  update(): void {
    const s = 1 / this.scene.cameras.main.zoom, now = this.scene.time.now;
    for (const [slug, b] of this.bubbles) {
      const a = this.layer.avatars.get(slug);
      if (!a || (b.until !== null && now > b.until)) { this.hide(slug); continue; }
      b.text.setScale(s).setPosition(a.sprite.x, a.sprite.y - 58 * s);
    }
  }

  of(slug: string): { x: number; y: number; text: string } | null {
    const b = this.bubbles.get(slug);
    return b ? { x: b.text.x, y: b.text.y, text: b.label } : null;
  }
}
