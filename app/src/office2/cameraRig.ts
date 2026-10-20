import Phaser from "phaser";
import type { Avatar } from "./avatars.ts";
import { clampCenter, fitRect, stepZoom } from "./camera.ts";
import { T } from "./constants.ts";
import type { MapModel } from "./types.ts";

/** Follow / zoom / pan / room focus. Keys are read from the focused host element, so typing in other panels never moves the camera. */
export class CameraRig {
  private readonly scene: Phaser.Scene;
  private readonly model: MapModel;
  private readonly founder: () => Avatar | undefined;
  private following = true;
  private target: Phaser.GameObjects.Sprite | null = null;
  space = false;

  constructor(scene: Phaser.Scene, model: MapModel, host: HTMLElement, founder: () => Avatar | undefined) {
    this.scene = scene;
    this.model = model;
    this.founder = founder;
    const cam = scene.cameras.main;
    cam.setBounds(0, 0, model.width * T, model.height * T);
    cam.setZoom(1);
    cam.centerOn(model.start[0] * T, model.start[1] * T);
    scene.input.mouse?.disableContextMenu();
    scene.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => this.zoomBy(dy < 0 ? 1 : -1));
    scene.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!(p.middleButtonDown() || p.rightButtonDown() || (this.space && p.leftButtonDown()))) return;
      this.stopFollow();
      cam.scrollX -= (p.x - p.prevPosition.x) / cam.zoom;
      cam.scrollY -= (p.y - p.prevPosition.y) / cam.zoom;
      this.clamp();
    });
    host.tabIndex = 0;
    host.style.outline = "none";
    const onKey = (e: KeyboardEvent, down: boolean) => {
      if (e.code === "Space") { this.space = down; if (down) e.preventDefault(); return; }
      if (!down) return;
      if (e.key === "f" || e.key === "F") this.toggleFollow();
      else if (e.key === "Home") this.home();
      else if (e.key === "+" || e.key === "=") this.zoomBy(1);
      else if (e.key === "-" || e.key === "_") this.zoomBy(-1);
      else if (/^[1-8]$/.test(e.key)) this.focusRoom(Number(e.key));
    };
    const kd = (e: KeyboardEvent) => onKey(e, true), ku = (e: KeyboardEvent) => onKey(e, false);
    host.addEventListener("keydown", kd);
    host.addEventListener("keyup", ku);
    host.addEventListener("pointerdown", () => host.focus());
    scene.events.once("shutdown", () => { host.removeEventListener("keydown", kd); host.removeEventListener("keyup", ku); });
  }

  isFollowing(): boolean { return this.following; }

  /** Call every frame: starts following the founder as soon as that avatar exists. */
  update(): void {
    const f = this.founder();
    if (this.following && f && this.target !== f.sprite) {
      this.target = f.sprite;
      this.scene.cameras.main.startFollow(f.sprite, true, 0.12, 0.12);
    }
  }

  private stopFollow(): void {
    this.following = false;
    this.target = null;
    this.scene.cameras.main.stopFollow();
  }

  private clamp(): void {
    const cam = this.scene.cameras.main;
    const [cx, cy] = clampCenter(cam.midPoint.x, cam.midPoint.y, cam.width, cam.height, cam.zoom, this.model.width * T, this.model.height * T);
    cam.centerOn(cx, cy);
  }

  zoomBy(dir: 1 | -1): void {
    const cam = this.scene.cameras.main;
    cam.setZoom(stepZoom(cam.zoom, dir));
    if (!this.following) this.clamp();
  }
  zoomIn(): void { this.zoomBy(1); }
  zoomOut(): void { this.zoomBy(-1); }

  toggleFollow(): void {
    if (this.following) this.stopFollow(); else { this.following = true; this.target = null; }
  }

  home(): void {
    this.scene.cameras.main.setZoom(1);
    this.following = true;
    this.target = null;
  }

  centerOn(x: number, y: number): void {
    this.stopFollow();
    this.scene.cameras.main.centerOn(x, y);
    this.clamp();
  }

  /** Zoom to fit the n-th focusable room (1-based, map order). */
  focusRoom(n: number): void {
    const a = this.model.areas.filter((r) => r.focusable)[n - 1];
    if (!a) return;
    const cam = this.scene.cameras.main;
    const f = fitRect({ x: a.x * T, y: a.y * T, w: a.w * T, h: a.h * T }, cam.width, cam.height);
    this.stopFollow();
    cam.setZoom(f.zoom);
    cam.centerOn(f.cx, f.cy);
    this.clamp();
  }

  focusRoomById(room: string): void {
    const i = this.model.areas.filter((r) => r.focusable).findIndex((r) => r.room === room);
    if (i >= 0) this.focusRoom(i + 1);
  }

  followAvatar(sprite: Phaser.GameObjects.Sprite): void {
    this.following = false;
    this.target = sprite;
    this.scene.cameras.main.startFollow(sprite, true, 0.12, 0.12);
  }
}
