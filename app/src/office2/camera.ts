export const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3] as const;

const nearestIndex = (z: number) => ZOOM_STEPS.reduce((bi, s, i) => (Math.abs(s - z) < Math.abs(ZOOM_STEPS[bi] - z) ? i : bi), 0);

/** Next zoom step in direction dir (+1 in, -1 out), clamped to the first/last step. */
export function stepZoom(current: number, dir: 1 | -1): number {
  const i = Math.min(ZOOM_STEPS.length - 1, Math.max(0, nearestIndex(current) + dir));
  return ZOOM_STEPS[i];
}

/** Clamp the camera centre (world px) so the visible area (view px / zoom) stays inside the world; a view larger than the world is centred. */
export function clampCenter(cx: number, cy: number, viewW: number, viewH: number, zoom: number, worldW: number, worldH: number): [number, number] {
  const hw = viewW / zoom / 2, hh = viewH / zoom / 2;
  const x = hw * 2 >= worldW ? worldW / 2 : Math.min(worldW - hw, Math.max(hw, cx));
  const y = hh * 2 >= worldH ? worldH / 2 : Math.min(worldH - hh, Math.max(hh, cy));
  return [x, y];
}

export function worldToMini(x: number, y: number, world: { w: number; h: number }, mini: { w: number; h: number }): [number, number] {
  return [(x / world.w) * mini.w, (y / world.h) * mini.h];
}
export function miniToWorld(x: number, y: number, world: { w: number; h: number }, mini: { w: number; h: number }): [number, number] {
  return [(x / mini.w) * world.w, (y / mini.h) * world.h];
}

/** Zoom step and centre that fit a world-pixel rectangle (with padding px) into the view. Never zooms in beyond 2. */
export function fitRect(r: { x: number; y: number; w: number; h: number }, viewW: number, viewH: number, pad = 48): { zoom: number; cx: number; cy: number } {
  const fit = Math.min(viewW / (r.w + pad * 2), viewH / (r.h + pad * 2));
  let zoom: number = ZOOM_STEPS[0];
  for (const s of ZOOM_STEPS) if (s <= fit && s <= 2) zoom = s;
  return { zoom, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}
