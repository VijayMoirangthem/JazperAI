export type GridPoint = readonly [number, number];
export interface BuilderObject { id: string; pos: GridPoint; footprint: readonly [number, number]; blocks: boolean; }

export const footprintCells = (pos: GridPoint, footprint: readonly [number, number]): [number, number][] => {
  const cells: [number, number][] = [];
  for (let x = 0; x < footprint[0]; x++) for (let z = 0; z < footprint[1]; z++) cells.push([pos[0] + x, pos[1] + z]);
  return cells;
};
export const overlapsBlockingObject = (candidate: BuilderObject, objects: readonly BuilderObject[]): boolean => {
  if (!candidate.blocks) return false;
  const used = new Set(objects.filter(object => object.blocks && object.id !== candidate.id).flatMap(object => footprintCells(object.pos, object.footprint).map(cell => cell.join(","))));
  return footprintCells(candidate.pos, candidate.footprint).some(cell => used.has(cell.join(",")));
};
export const inWorldBounds = (point: GridPoint, footprint: GridPoint, size: GridPoint): boolean => point[0] >= 0 && point[1] >= 0 && point[0] + footprint[0] <= size[0] && point[1] + footprint[1] <= size[1];
