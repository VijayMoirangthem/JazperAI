import Phaser from "phaser";
import type { Avatar, AvatarLayer } from "./avatars.ts";
import { createWalkQueue } from "./behavior.ts";
import { T } from "./constants.ts";
import { findPath, nearestFree } from "./pathfind.ts";
import type { Dir } from "./avatarSheet.ts";
import type { MapModel, Pt } from "./types.ts";

const MS_PER_TILE = 140;

interface Walk { path: Pt[]; started: boolean }

/** Per-frame tile walking (no tweens). The founder walks at once; bots go through a queue of at most 4 simultaneous walkers. */
export class Walker {
  private readonly layer: AvatarLayer;
  private readonly model: MapModel;
  private readonly walks = new Map<string, Walk>();
  private readonly queue = createWalkQueue(4);
  private readonly scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, model: MapModel, layer: AvatarLayer) {
    this.scene = scene;
    this.model = model;
    this.layer = layer;
  }

  private tileOf(a: Avatar): Pt { return [Math.floor(a.sprite.x / T), Math.floor(a.sprite.y / T)]; }

  /** Walk to a tile (or the nearest free one). False when there is no route. */
  walkTo(slug: string, tx: number, ty: number): boolean {
    const a = this.layer.avatars.get(slug);
    if (!a) return false;
    let goal: Pt = [tx, ty];
    if (this.model.blocked[ty]?.[tx] !== false) {
      const free = nearestFree(this.model.blocked, goal, new Set());
      if (!free) return false;
      goal = free;
    }
    const from = this.tileOf(a);
    if (from[0] === goal[0] && from[1] === goal[1]) return true;
    const path = findPath(this.model.blocked, from, goal);
    if (!path.length) return false;
    a.tile = goal;
    this.stop(slug);
    const walk: Walk = { path, started: false };
    this.walks.set(slug, walk);
    if (a.person.kind === "human" || this.queue.request(slug)) this.begin(a, walk);
    return true;
  }

  stop(slug: string): void {
    if (!this.walks.has(slug)) return;
    this.walks.delete(slug);
    const next = this.queue.finish(slug);
    if (next) this.startQueued(next);
    const a = this.layer.avatars.get(slug);
    if (a) this.idle(a);
  }

  isWalking(slug: string): boolean { return this.walks.get(slug)?.started === true; }

  private startQueued(slug: string): void {
    const a = this.layer.avatars.get(slug), w = this.walks.get(slug);
    if (a && w) this.begin(a, w);
  }

  private begin(a: Avatar, w: Walk): void {
    w.started = true;
    a.walking = true;
  }

  private idle(a: Avatar): void {
    a.walking = false;
    a.sprite.play(`${a.key}:idle:${a.facing}`, true);
  }

  update(deltaMs: number): void {
    const step = (deltaMs * T) / MS_PER_TILE;
    for (const [slug, w] of [...this.walks]) {
      if (!w.started) continue;
      const a = this.layer.avatars.get(slug);
      if (!a) { this.walks.delete(slug); continue; }
      let budget = step;
      while (budget > 0 && w.path.length) {
        const [tx, ty] = w.path[0];
        const [gx, gy] = [tx * T + T / 2, ty * T + 28];
        const dx = gx - a.sprite.x, dy = gy - a.sprite.y, dist = Math.hypot(dx, dy);
        const facing: Dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
        if (facing !== a.facing || !a.sprite.anims.isPlaying || !a.sprite.anims.currentAnim?.key.includes(":walk:")) {
          a.facing = facing;
          a.sprite.play(`${a.key}:walk:${facing}`, true);
        }
        if (dist <= budget) { this.layer.setPosition(a, gx, gy); budget -= dist; w.path.shift(); }
        else { this.layer.setPosition(a, a.sprite.x + (dx / dist) * budget, a.sprite.y + (dy / dist) * budget); budget = 0; }
      }
      if (!w.path.length) this.stop(slug);
    }
  }
}
