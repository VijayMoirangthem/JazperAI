/** FNV-1a 32-bit string hash (same function as app/src/office/sprites.ts). Deterministic across runs. */
export const hash = (s: string): number => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
