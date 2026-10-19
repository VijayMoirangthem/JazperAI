// A flying message envelope between two agents, tinted by the sender accent.
// Arcs from sender to receiver, then pops into a small burst.

import * as PIXI from "pixi.js";
import type { Character } from "./Character";

export const ACT_COLOR: Record<string, string> = {
  request: "#f59e0b",
  inform: "#3b82f6",
  propose: "#10b981",
  query: "#8b5cf6",
  agree: "#22c55e",
  refuse: "#ef4444",
  done: "#06b6d4",
};

export class MessageEnvelope extends PIXI.Container {
  private bg: PIXI.Graphics;
  private line: PIXI.Graphics;
  private textEl: PIXI.Text;
  private from: Character;
  private to: Character;
  private t = 0;
  private dur = 1.4; // seconds
  private done = false;

  constructor(from: Character, to: Character, text: string, act: string, color: string) {
    super();
    this.from = from;
    this.to = to;
    this.zIndex = 40;

    const tint = ACT_COLOR[act] ?? color ?? "#94a3b8";
    const tintNum = parseInt(tint.replace("#", ""), 16) || 0x94a3b8;

    this.bg = new PIXI.Graphics();
    this.bg.roundRect(-16, -10, 32, 20, 4).fill({ color: 0xffffff, alpha: 0.95 });
    this.bg.roundRect(-16, -10, 32, 20, 4).stroke({ color: tintNum, width: 2 });
    // envelope flap
    this.bg.moveTo(-16, -10).lineTo(0, 0).lineTo(16, -10).stroke({ color: tintNum, width: 2 });
    this.textEl = new PIXI.Text({ text: text.length > 24 ? text.slice(0, 22) + "…" : text, style: { fontFamily: '"JetBrains Mono", monospace', fontSize: 9, fill: tint, wordWrap: true, wordWrapWidth: 120 } });
    this.textEl.anchor.set(0.5, 0.5);
    this.line = new PIXI.Graphics();
    this.addChild(this.bg, this.textEl, this.line);
  }

  update(deltaMS: number, deltaSeconds: number) {
    if (this.done) return;
    this.t += deltaSeconds;
    const p = Math.min(1, this.t / this.dur);
    if (p >= 1) {
      this.done = true;
      this.emit("arrived", this);
      return;
    }

    const a = this.from.centerPx();
    const b = this.to.centerPx();
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const arc = 1 - Math.pow(2 * p - 1, 2); // parabola 0→1→0
    const x = a.x + (b.x - a.x) * p;
    const y = my - arc * 60;

    this.position.set(x, y);
    this.alpha = p < 0.1 ? p / 0.1 : 1;

    // draw a dashed flight line
    this.line.clear();
    this.line.moveTo(a.x, a.y - 10).lineTo(x, y).stroke({ color: 0xffffff, width: 1, alpha: 0.3 });
  }

  get isDone() { return this.done; }
}