// Fit-to-screen lerp camera, ported from Munder Difflin's Camera.ts.
// Operates on the world Container: sets its scale + position each tick so the
// world is centred and fitted inside the viewport with padding.

export class Camera {
  scale = 1;
  private x = 0;
  private y = 0;
  private targetX = 0;
  private targetY = 0;
  private targetScale = 1;

  private vw = 800;
  private vh = 600;

  setViewport(w: number, h: number) {
    this.vw = w;
    this.vh = h;
    this.fitToWorld();
  }

  /** Fit the given world rect (pixels) into the viewport with padding. */
  fitToWorld(worldW = 0, worldH = 0) {
    const pad = 32;
    const availW = Math.max(1, this.vw - pad * 2);
    const availH = Math.max(1, this.vh - pad * 2);
    const sx = worldW > 0 ? availW / worldW : 1;
    const sy = worldH > 0 ? availH / worldH : 1;
    this.targetScale = Math.min(sx, sy, 2.4);
    this.targetX = worldW / 2;
    this.targetY = worldH / 2;
  }

  /** Pan/follow a world point (pixels) — this point will be centred. */
  focus(worldX: number, worldY: number) {
    this.targetX = worldX;
    this.targetY = worldY;
  }

  /** Zoom towards a scale (multiplied with the fit scale). */
  zoom(factor: number) {
    this.targetScale = Math.max(0.4, Math.min(6, this.targetScale * factor));
  }

  /** Instantly snap to the target transform (no lerp). */
  snap() {
    this.scale = this.targetScale;
    this.x = this.vw / 2 - this.targetX * this.scale;
    this.y = this.vh / 2 - this.targetY * this.scale;
  }

  /** Apply the camera transform to a world container. Called every tick. */
  apply(container: { scale: { set: (s: number, s2: number) => void }; position: { set: (x: number, y: number) => void } }) {
    this.x = this.vw / 2 - this.targetX * this.scale;
    this.y = this.vh / 2 - this.targetY * this.scale;
    container.scale.set(this.scale, this.scale);
    container.position.set(this.x, this.y);
  }

  /** Smoothly approach the target transform each tick. */
  lerp(factor = 0.08) {
    this.scale += (this.targetScale - this.scale) * factor;
  }

  /** Convert a world pixel point to stage (screen) pixel coordinates. */
  toScreen(wx: number, wy: number): { x: number; y: number } {
    return { x: (wx - this.targetX) * this.scale + this.vw / 2, y: (wy - this.targetY) * this.scale + this.vh / 2 };
  }
}