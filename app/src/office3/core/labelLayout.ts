export interface LabelCandidate { id: string; x: number; y: number; distance: number; priority: number; }
export interface LabelPlacement { id: string; x: number; y: number; detail: "dot" | "name" | "full"; visible: boolean; }

/** Stable, allocation-light layout contract for projected actor labels. */
export function layoutLabels(candidates: readonly LabelCandidate[], width: number, height: number): LabelPlacement[] {
  const occupied: { x: number; y: number; width: number; height: number }[] = [];
  return [...candidates].sort((a, b) => b.priority - a.priority || a.distance - b.distance).map(candidate => {
    const detail: LabelPlacement["detail"] = candidate.distance > 30 ? "dot" : candidate.distance > 15 ? "name" : "full";
    if (candidate.x < -20 || candidate.y < -20 || candidate.x > width + 20 || candidate.y > height + 20) return { id: candidate.id, x: candidate.x, y: candidate.y, detail, visible: false };
    if (detail === "dot") return { id: candidate.id, x: candidate.x, y: candidate.y, detail, visible: true };
    const boxWidth = detail === "full" ? 112 : 72, boxHeight = detail === "full" ? 34 : 20;
    let y = candidate.y;
    while (occupied.some(box => Math.abs(box.x - candidate.x) < (box.width + boxWidth) / 2 && Math.abs(box.y - y) < (box.height + boxHeight) / 2)) y -= boxHeight + 4;
    const visible = y > -boxHeight && y < height + boxHeight;
    if (visible) occupied.push({ x: candidate.x, y, width: boxWidth, height: boxHeight });
    return { id: candidate.id, x: candidate.x, y, detail, visible };
  });
}
