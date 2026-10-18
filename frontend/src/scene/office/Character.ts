// An agent standing on the floor — pixel avatar sprite, status ring, name tag,
// thought bubble, carrying badge, and walking animation driven by a BFS path.

import * as PIXI from "pixi.js";
import type { FloorAgent, Desk } from "./types";
import { pixelAvatar, mix } from "./pixelAvatar";
import { ThoughtBubble } from "./ThoughtBubble";
import { findPath } from "./pathfinding";
import type { Grid } from "./pathfinding";

const FONT = '"JetBrains Mono", monospace';

export const TILE = 24; // px per grid tile (before camera scale)

export const STATUS_COLOR: Record<string, string> = {
  idle: "#6b7a9a",
  thinking: "#8b5cf6",
  working: "#10b981",
  blocked: "#ef4444",
  compacting: "#f59e0b",
  looping: "#eab308",
  success: "#22c55e",
  error: "#ef4444",
  offline: "#475569",
};

const STATUS_LABEL: Record<string, string> = {
  idle: "IDLE", thinking: "THINKING", working: "WORKING", blocked: "BLOCKED",
  compacting: "COMPACTING", looping: "LOOPING", success: "DONE", error: "ERROR", offline: "OFF",
};

export class Character extends PIXI.Container {
  readonly agentId: string;
  codename: string;
  name: string;
  accent: string;
  isGod: boolean;
  status: FloorAgent["status"] = "idle";
  action = "";
  carrying: string | null = null;
  lastPrompt: string | null = null;

  private grid: Grid;
  desk: Desk | null;
  private path: Array<[number, number]> = [];
  private pathIx = 0;
  private walkX = 0;   // current pixel x (world)
  private walkY = 0;   // current pixel y (world)
  private targetTileX = 0;
  private targetTileY = 0;
  private speed = 46;  // px/sec walk speed
  private bobT = 0;
  private moving = false;

  private sprite: PIXI.Sprite;
  private ring: PIXI.Graphics;
  private nameTag: PIXI.Container;
  private nameText: PIXI.Text;
  private carryTag: PIXI.Text | null = null;
  private statusText: PIXI.Text;
  private bubble: ThoughtBubble;
  private pulseT = 0;
  private selected = false;
  private selectionRing: PIXI.Graphics;

  constructor(grid: Grid, agent: FloorAgent, desk: Desk | null) {
    super();
    this.agentId = agent.id;
    this.codename = agent.codename;
    this.name = agent.name;
    this.accent = agent.accent;
    this.isGod = !!agent.isGod;
    this.status = agent.status;
    this.action = agent.action ?? "";
    this.carrying = agent.carrying ?? null;
    this.lastPrompt = agent.lastPrompt ?? null;
    this.grid = grid;
    this.desk = desk;
    this.zIndex = 10;

    const tex = PIXI.Texture.from(pixelAvatar(agent.codename, agent.accent));
    this.sprite = new PIXI.Sprite(tex);
    this.sprite.anchor.set(0.5, 0.92);
    this.addChild(this.sprite);

    this.ring = new PIXI.Graphics();
    this.addChild(this.ring);

    this.selectionRing = new PIXI.Graphics();
    this.selectionRing.visible = false;
    this.addChild(this.selectionRing);

    this.nameText = new PIXI.Text({ text: this.name, style: { fontFamily: FONT, fontSize: 9, fill: "#c8d0e8", stroke: { color: "#000000", width: 3 }, align: "center" } });
    this.nameText.anchor.set(0.5, 1);
    this.statusText = new PIXI.Text({ text: "", style: { fontFamily: FONT, fontSize: 7, fill: "#111111", fontWeight: "700", stroke: { color: "#ffffff", width: 2 }, align: "center" } });
    this.statusText.anchor.set(0.5, 0.5);

    this.nameTag = new PIXI.Container();
    this.nameTag.addChild(this.nameText);
    this.nameTag.y = -20;
    this.addChild(this.nameTag);

    this.bubble = new ThoughtBubble();
    this.addChild(this.bubble);

    const start = desk
      ? { x: desk.x, y: desk.y }
      : { x: Math.floor(this.grid.w / 2), y: this.grid.h - 2 };
    this.walkX = start.x * TILE;
    this.walkY = start.y * TILE;
    this.targetTileX = start.x;
    this.targetTileY = start.y;

    this.drawStatus();
    this.updateSprite(0);
    this.position.set(this.walkX, this.walkY);
  }

  // ── Public state setters ────────────────────────────────────────────────

  setState(agent: Partial<FloorAgent>) {
    if (agent.status && agent.status !== this.status) {
      this.status = agent.status;
      this.pulseT = 0;
      this.drawStatus();
    }
    if (agent.action !== undefined && agent.action !== this.action) {
      this.action = agent.action ?? "";
      if (this.action && Math.random() < 0.35) this.bubble.show(this.action);
    }
    if (agent.carrying !== undefined) this.carrying = agent.carrying ?? null;
    if (agent.lastPrompt !== undefined && agent.lastPrompt !== this.lastPrompt) {
      this.lastPrompt = agent.lastPrompt ?? null;
      if (this.lastPrompt) this.bubble.show(this.lastPrompt, 6);
    }
  }

  setSelected(sel: boolean) {
    this.selected = sel;
    this.selectionRing.visible = sel;
    this.drawSelection();
  }

  showBubble(text: string, durationSec = 4.5) {
    this.bubble.show(text, durationSec);
  }

  /** Wander to a random nearby walkable tile (used when idle). */
  wander() {
    const rnd = Math.floor(Math.random() * 4);
    let tx = this.targetTileX, ty = this.targetTileY;
    const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rnd];
    tx += dx; ty += dy;
    this.moveTo(tx, ty);
  }

  moveTo(tileX: number, tileY: number) {
    const path = findPath(this.grid, this.targetTileX, this.targetTileY, tileX, tileY);
    if (path.length < 2) return;
    this.path = path.slice(1);
    this.pathIx = 0;
    this.targetTileX = tileX;
    this.targetTileY = tileY;
  }

  goHome() {
    if (this.desk) this.moveTo(this.desk.x, this.desk.y);
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private drawStatus() {
    const color = STATUS_COLOR[this.status] ?? "#6b7a9a";
    this.ring.clear();
    this.ring.circle(0, -34, 8).fill({ color: color as unknown as number, alpha: 0.15 });
    this.ring.circle(0, -34, 6.5).stroke({ color: color as unknown as number, width: 1.5 });
    this.statusText.text = STATUS_LABEL[this.status] ?? this.status;
    this.statusText.position.set(0, -34);
    this.statusText.pivot.set(this.statusText.width / 2, this.statusText.height / 2);
    if (!this.statusText.parent) this.addChild(this.statusText);
  }

  private drawSelection() {
    this.selectionRing.clear();
    if (!this.selected) return;
    this.selectionRing.ellipse(0, -14, 12, 5).stroke({ color: 0xffffff, width: 2, alpha: 0.9 });
  }

  private updateSprite(deltaMS: number) {
    // vertical bob while walking
    const bob = this.moving ? Math.abs(Math.sin(this.bobT * 8)) * -2 : 0;
    this.sprite.y = bob;
    if (this.bubble.visible) this.bubble.update(deltaMS);

    // pulse for active statuses
    this.pulseT += deltaMS / 1000;
    const active = this.status === "working" || this.status === "thinking" || this.status === "blocked";
    const ringScale = 1 + (active ? Math.sin(this.pulseT * 5) * 0.12 : 0);
    this.ring.scale.set(ringScale, ringScale);
  }

  update(deltaMS: number) {
    // walk the path
    this.moving = false;
    if (this.pathIx < this.path.length) {
      const [tx, ty] = this.path[this.pathIx];
      const dx = tx * TILE - this.walkX;
      const dy = ty * TILE - this.walkY;
      const dist = Math.hypot(dx, dy);
      const step = this.speed * (deltaMS / 1000);
      if (dist <= step) {
        this.walkX = tx * TILE;
        this.walkY = ty * TILE;
        this.pathIx++;
        this.moving = true;
      } else {
        this.walkX += (dx / dist) * step;
        this.walkY += (dy / dist) * step;
        this.moving = true;
      }
      this.bobT += deltaMS / 1000;
    }
    this.position.set(this.walkX, this.walkY);
    this.updateSprite(deltaMS);
  }

  /** Pixel centre of the agent on the floor. */
  centerPx(): { x: number; y: number } {
    return { x: this.walkX, y: this.walkY - 10 };
  }

  centerTile(): { x: number; y: number } {
    return { x: this.targetTileX, y: this.targetTileY };
  }
}

export function tileCenterPx(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE, y: ty * TILE };
}

export function accentColor(hex: string): number {
  return parseInt(hex.replace("#", ""), 16) || 0x6366f1;
}