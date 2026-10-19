export interface Hunk { id: string; old_start: number; old_lines: number; patch: string }

export const addedLines = (h: Hunk): string[] => h.patch.split("\n").filter((l) => l.startsWith("+")).map((l) => l.slice(1));

/** Old text with the accepted hunks applied (hunks never overlap; old_start is a 0-based line index). */
export function applyAccepted(original: string, hunks: Hunk[], rejected: Set<string>): string {
  const old = original.split("\n");
  const out: string[] = [];
  let pos = 0;
  for (const h of [...hunks].sort((a, b) => a.old_start - b.old_start)) {
    if (rejected.has(h.id)) continue;
    out.push(...old.slice(pos, h.old_start), ...addedLines(h));
    pos = h.old_start + h.old_lines;
  }
  return [...out, ...old.slice(pos)].join("\n");
}
