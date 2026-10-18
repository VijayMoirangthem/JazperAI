// A small speech/thought bubble that floats above an agent and fades out.

import * as PIXI from "pixi.js";

const FONT = '"JetBrains Mono", monospace';

export class ThoughtBubble extends PIXI.Container {
  private bg: PIXI.Graphics;
  private textEl: PIXI.Text;
  private _life = 0;
  private _maxLife = 4.5;

  constructor() {
    super();
    this.bg = new PIXI.Graphics();
    this.textEl = new PIXI.Text({ text: "", style: { fontFamily: FONT, fontSize: 11, fill: "#111111", wordWrap: true, wordWrapWidth: 180, lineHeight: 15 } });
    this.addChild(this.bg, this.textEl);
    this.visible = false;
    this.zIndex = 50;
  }

  show(text: string, durationSec = 4.5) {
    this.textEl.text = text;
    this._life = durationSec;
    this._maxLife = durationSec;
    this.redraw();
    this.visible = true;
    this.alpha = 1;
    this.scale.set(1);
  }

  private redraw() {
    const pad = 7;
    const w = Math.min(200, Math.max(60, this.textEl.width + pad * 2));
    const h = this.textEl.height + pad * 2;
    this.bg.clear();
    this.bg.roundRect(-w / 2, -h / 2, w, h, 6).fill(0xf5f5f5);
    // tail
    this.bg.moveTo(0, h / 2).lineTo(5, h / 2 + 6).lineTo(-5, h / 2).closePath().fill(0xf5f5f5);
    this.textEl.position.set(-this.textEl.width / 2, -this.textEl.height / 2 + 2);
    this.y = -34;
  }

  update(deltaMS: number) {
    if (!this.visible) return;
    this._life -= deltaMS / 1000;
    const t = this._life / this._maxLife;
    if (t <= 0) {
      this.visible = false;
      return;
    }
    this.alpha = t < 0.3 ? t / 0.3 : 1;
    this.y = -34 - (1 - Math.min(1, t)) * 6;
  }
}