export type Selection = ReadonlySet<string>;
export const toggleSelection = (selection: Selection, id: string): Set<string> => { const next = new Set(selection); next.has(id) ? next.delete(id) : next.add(id); return next; };
export const replaceSelection = (ids: Iterable<string>): Set<string> => new Set(ids);
export const extendSelection = (selection: Selection, ids: Iterable<string>): Set<string> => new Set([...selection, ...ids]);
export const clearSelection = (): Set<string> => new Set();
export const selectionFromBox = (items: readonly { id: string; x: number; y: number }[], box: { left: number; top: number; right: number; bottom: number }): Set<string> => new Set(items.filter(item => item.x >= Math.min(box.left, box.right) && item.x <= Math.max(box.left, box.right) && item.y >= Math.min(box.top, box.bottom) && item.y <= Math.max(box.top, box.bottom)).map(item => item.id));
