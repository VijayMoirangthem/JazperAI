import { Container } from 'pixi.js';

// Comprehensive Camera system with zoom/pan/smooth transitions/bounds.
// Based on shahar061/the-office office/engine/camera.ts with enhanced features.

const LERP_SPEED = 0.12;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.25;
const PAN_SPEED = 300; // pixels/sec

export class Camera {
  private container: Container;
  private currentX = 0;
  private currentY = 0;
  private currentZoom = 1;
  private targetX = 0;
  private targetY = 0;
  private targetZoom = 1;
  private viewWidth = 0;
  private viewHeight = 0;
  private mapWidth = 0;
  private mapHeight = 0;
  private manualOverride = false;
  private zoomAnimated = false;

  private zoomFromPointX = 0;
  private zoomFromPointY = 0;

  private panStartX = 0;
  private panStartY = 0;
  private panCurrentX = 0;
  private panCurrentY = 0;
  private panning = false;

  private dragging = false;
  private dragStartScreenX = 0;
  private dragStartScreenY = 0;
  private dragCamX = 0;
  private dragCamY = 0;

  constructor(container: Container) {
    this.container = container;
  }

  /** Set the map dimensions (in floor pixels). */
  setMapSize(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
    this.fitToScreen();
  }

  /** Set the viewport dimensions (in screen pixels). */
  setViewSize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    if (!this.manualOverride) this.fitToScreen();
  }

  /** Current zoom level (1.0 = 100%). */
  getZoom(): number {
    return this.currentZoom;
  }

  /** Get current visible bounds in floor coordinates. */
  getVisibleBounds(): { x: number; y: number; width: number; height: number } {
    const scaledW = this.mapWidth * this.currentZoom;
    const scaledH = this.mapHeight * this.currentZoom;
    return {
      x: this.container.x / this.currentZoom + this.viewWidth / (2 * this.currentZoom),
      y: this.container.y / this.currentZoom + this.viewHeight / (2 * this.currentZoom),
      width: this.viewWidth / this.currentZoom,
      height: this.viewHeight / this.currentZoom,
    };
  }

  /** Fit the whole map to the viewport, centered. */
  fitToScreen(): void {
    this.manualOverride = false;
    this.targetX = this.mapWidth / 2;
    this.targetY = this.mapHeight / 2;
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.getMinZoom()));
    this.zoomAnimated = false;
  }

  /** Get the minimum zoom that fits the map dimension. */
  private getMinZoom(): number {
    if (this.viewWidth === 0 || this.viewHeight === 0) return 1;
    return Math.min(this.viewWidth / this.mapWidth, this.viewHeight / this.mapHeight);
  }

  /** Zoom in by one step. Anchor is screen coords within the canvas (optional). */
  zoomIn(anchor?: { x: number; y: number }): void {
    this.zoomTo(this.currentZoom - ZOOM_STEP, this.screenToWorld(anchor));
  }

  /** Zoom out by one step. Anchor is screen coords within the canvas (optional). */
  zoomOut(anchor?: { x: number; y: number }): void {
    this.zoomTo(this.currentZoom + ZOOM_STEP, this.screenToWorld(anchor));
  }

  /** Convert canvas-local screen coords to world coords. */
  screenToWorld(screen?: { x: number; y: number }): { x: number; y: number } {
    const sx = screen?.x ?? this.viewWidth / 2;
    const sy = screen?.y ?? this.viewHeight / 2;
    return {
      x: this.currentX + (sx - this.viewWidth / 2) / this.currentZoom,
      y: this.currentY + (sy - this.viewHeight / 2) / this.currentZoom,
    };
  }

  /** Reset zoom to 1.0, centered on viewport. */
  resetZoom(): void {
    this.targetZoom = 1;
    this.zoomFromPointX = this.viewWidth / 2;
    this.zoomFromPointY = this.viewHeight / 2;
    this.zoomAnimated = false;
  }

  /** Zoom to a specific level, anchored at world point. */
  zoomTo(targetZ: number, anchor?: { x: number; y: number }): void {
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZ));
    this.zoomFromPointX = anchor?.x ?? this.viewWidth / 2;
    this.zoomFromPointY = anchor?.y ?? this.viewHeight / 2;
    this.zoomAnimated = true;
    this.manualOverride = true;
  }

  /** Pan the camera to a world point with smooth animation. */
  panTo(x: number, y: number, duration?: number): void {
    this.targetX = x;
    this.targetY = y;

    if (duration === undefined || duration <= 0) {
      this.currentX = x;
      this.currentY = y;
    } else {
      this.panStartX = this.currentX;
      this.panStartY = this.currentY;
      this.panCurrentX = x;
      this.panCurrentY = y;
      this.panning = true;
    }
  }

  /** Pan by an offset (in floor pixels). */
  panBy(dx: number, dy: number): void {
    this.targetX = this.currentX + dx;
    this.targetY = this.currentY + dy;
  }

  /** Focus on a specific zone center. */
  focusOnZone(zoneX: number, zoneY: number, zoom?: number): void {
    this.targetX = zoneX;
    this.targetY = zoneY;
    if (zoom !== undefined) {
      this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    }
    this.manualOverride = true;
  }

  /** Focus on a specific agent position. */
  focusOnAgent(agentX: number, agentY: number): void {
    this.targetX = agentX;
    this.targetY = agentY;
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.currentZoom * 1.5));
    this.manualOverride = true;
  }

  /** Update camera state each frame. */
  update(dt: number): void {
    // Smooth lerp toward targets
    this.currentX += (this.targetX - this.currentX) * LERP_SPEED;
    this.currentY += (this.targetY - this.currentY) * LERP_SPEED;
    this.currentZoom += (this.targetZoom - this.currentZoom) * LERP_SPEED;

    // Clamp zoom to bounds
    this.currentZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.currentZoom));

    // If zooming from a point, animate the anchor center staying put
    if (this.zoomAnimated) {
      // Calculate how much the viewport has moved due to zoom
      const prevScale = this.zoomAnimated === 1 ? 1 : this.currentZoom;
      // Simple approach: just ensure the anchor point stays fixed
      const anchorWorldX = this.zoomFromPointX;
      const anchorWorldY = this.zoomFromPointY;

      // Adjust camera position so anchor point stays fixed
      this.currentX = anchorWorldX - (this.viewWidth / 2) / this.currentZoom;
      this.currentY = anchorWorldY - (this.viewHeight / 2) / this.currentZoom;
    }

    // Apply position to container
    this.container.scale.set(this.currentZoom);
    this.container.x = this.viewWidth / 2 - this.currentX * this.currentZoom;
    this.container.y = this.viewHeight / 2 - this.currentY * this.currentZoom;

    // Bounds clamping - prevent showing empty space beyond map
    const scaledW = this.mapWidth * this.currentZoom;
    const scaledH = this.mapHeight * this.currentZoom;

    // Left/Top bounds (camera can't show beyond map origin)
    this.container.x = Math.min(0, Math.max(this.viewWidth - scaledW, this.container.x));
    this.container.y = Math.min(0, Math.max(this.viewHeight - scaledH, this.container.y));

    // Right/Bottom bounds
    if (scaledW > this.viewWidth) {
      this.container.x = Math.max(this.viewWidth - scaledW, this.container.x);
    } else {
      this.container.x = (this.viewWidth - scaledW) / 2;
    }
    if (scaledH > this.viewHeight) {
      this.container.y = Math.max(this.viewHeight - scaledH, this.container.y);
    } else {
      this.container.y = (this.viewHeight - scaledH) / 2;
    }

    // Nudge decay (if panning was active)
    if (this.panning) {
      // Simple velocity-based decay
      const elapsed = dt / 1000;
      const friction = 0.8;
      this.panCurrentX += (this.targetX - this.panCurrentX) * friction * elapsed;
      this.panCurrentY += (this.targetY - this.panCurrentY) * friction * elapsed;
      if (Math.abs(this.targetX - this.panCurrentX) < 0.1 && Math.abs(this.targetY - this.panCurrentY) < 0.1) {
        this.panning = false;
      }
      this.currentX = this.panCurrentX;
      this.currentY = this.panCurrentY;
    }
  }

  /** Handle mouse wheel zoom at cursor position (screen coords within canvas). */
  handleWheel(event: WheelEvent, screenX: number, screenY: number): void {
    event.preventDefault();
    const delta = event.deltaY < 0 ? -ZOOM_STEP : ZOOM_STEP;
    const world = this.screenToWorld({ x: screenX, y: screenY });
    this.zoomTo(this.currentZoom + delta, world);
  }

  /** Begin click-drag pan (screen coords within canvas). */
  startDragPan(screenX: number, screenY: number): void {
    this.dragging = true;
    this.manualOverride = true;
    this.dragStartScreenX = screenX;
    this.dragStartScreenY = screenY;
    this.dragCamX = this.currentX;
    this.dragCamY = this.currentY;
    this.targetX = this.currentX;
    this.targetY = this.currentY;
  }

  /** Continue click-drag pan. */
  updateDragPan(screenX: number, screenY: number): void {
    if (!this.dragging) return;
    const dx = (screenX - this.dragStartScreenX) / this.currentZoom;
    const dy = (screenY - this.dragStartScreenY) / this.currentZoom;
    this.targetX = this.dragCamX - dx;
    this.targetY = this.dragCamY - dy;
    this.currentX = this.targetX;
    this.currentY = this.targetY;
  }

  endDragPan(): void {
    this.dragging = false;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  /** Snapshot for persistence across refresh / floor switch. */
  getState(): { x: number; y: number; zoom: number } {
    return { x: this.currentX, y: this.currentY, zoom: this.currentZoom };
  }

  /** Restore saved camera view. */
  applyState(state: { x: number; y: number; zoom: number }): void {
    this.manualOverride = true;
    this.targetX = state.x;
    this.targetY = state.y;
    this.currentX = state.x;
    this.currentY = state.y;
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, state.zoom));
    this.currentZoom = this.targetZoom;
    this.zoomAnimated = false;
    this.applyTransform();
  }

  private applyTransform(): void {
    const scaledW = this.mapWidth * this.currentZoom;
    const scaledH = this.mapHeight * this.currentZoom;
    this.container.scale.set(this.currentZoom);
    this.container.x = this.viewWidth / 2 - this.currentX * this.currentZoom;
    this.container.y = this.viewHeight / 2 - this.currentY * this.currentZoom;
    this.container.x = Math.min(0, Math.max(this.viewWidth - scaledW, this.container.x));
    this.container.y = Math.min(0, Math.max(this.viewHeight - scaledH, this.container.y));
    if (scaledW <= this.viewWidth) this.container.x = (this.viewWidth - scaledW) / 2;
    if (scaledH <= this.viewHeight) this.container.y = (this.viewHeight - scaledH) / 2;
  }

  /** Handle mouse drag pan (middle-click legacy). */
  startPan(atX: number, atY: number): void {
    this.panning = true;
    this.panStartX = this.currentX;
    this.panStartY = this.currentY;
    this.panCurrentX = this.currentX;
    this.panCurrentY = this.currentY;
  }

  /** Continue pan drag. */
  updatePan(byX: number, byY: number): void {
    if (!this.panning) return;
    this.currentX = this.panStartX - byX;
    this.currentY = this.panStartY - byY;
  }

  /** End pan drag. */
  endPan(): void {
    this.panning = false;
  }

  /** Check if camera is currently animating. */
  isAnimating(): boolean {
    // Simple check: if target differs significantly from current
    const distX = Math.abs(this.targetX - this.currentX);
    const distY = Math.abs(this.targetY - this.currentY);
    const distZ = Math.abs(this.targetZoom - this.currentZoom);
    return distX > 1 || distY > 1 || distZ > 0.1;
  }
}
