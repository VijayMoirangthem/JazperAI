export interface TagItem { id: string; x: number; y: number; w: number; h: number; priority: number } // x = centre, y = top
export interface TagPos { id: string; x: number; y: number; moved: number }

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, gap: number) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Places tags one by one (highest priority first, then id). A tag that would overlap an already placed one is pushed UP until it fits. */
export function layoutTags(items: readonly TagItem[], gap = 2): TagPos[] {
  const order = [...items].sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : 1));
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out = new Map<string, TagPos>();
  for (const it of order) {
    let y = it.y;
    for (let guard = 0; guard < 1000; guard++) {
      const hit = placed.find((p) => overlaps({ x: it.x, y, w: it.w, h: it.h }, p, gap));
      if (!hit) break;
      y = hit.y - it.h - gap;
    }
    placed.push({ x: it.x, y, w: it.w, h: it.h });
    out.set(it.id, { id: it.id, x: it.x, y, moved: it.y - y });
  }
  return items.map((i) => out.get(i.id)!);
}

const ALWAYS_STATES = new Set(["error", "waiting_human", "escalated"]);
/** Tags hide when zoomed far out, except for the hovered/selected/founder avatar and agents that need attention. */
export function tagVisible(zoom: number, o: { hovered?: boolean; selected?: boolean; founder?: boolean; state?: string }): boolean {
  return zoom >= 0.75 || !!o.hovered || !!o.selected || !!o.founder || ALWAYS_STATES.has(o.state ?? "");
}
