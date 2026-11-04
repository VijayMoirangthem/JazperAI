/** Persistable undo/redo journal: commands are stored as plain before/after object snapshots so a draft survives a reload. */
export interface JournalEntry { id: string; op: "add" | "remove" | "update"; before: unknown | null; after: unknown | null }
export interface Journal { version: 1; world: string; done: JournalEntry[]; undone: JournalEntry[] }

const LIMIT = 200;
const MAX_BYTES = 256 * 1024;
const key = (world: string) => `office3.history.${world}`;
const isEntry = (e: unknown): e is JournalEntry =>
  !!e && typeof e === "object" && typeof (e as JournalEntry).id === "string" && ["add", "remove", "update"].includes((e as JournalEntry).op);

export function parseJournal(raw: string | null, world: string): Journal {
  const empty: Journal = { version: 1, world, done: [], undone: [] };
  if (!raw || raw.length > MAX_BYTES) return empty;
  try {
    const v = JSON.parse(raw) as Journal;
    if (v?.version !== 1 || v.world !== world || !Array.isArray(v.done) || !Array.isArray(v.undone)) return empty;
    return { version: 1, world, done: v.done.filter(isEntry).slice(-LIMIT), undone: v.undone.filter(isEntry).slice(-LIMIT) };
  } catch { return empty; }
}

export function saveJournal(j: Journal, storage: Pick<Storage, "setItem" | "removeItem"> = localStorage): boolean {
  try {
    let done = j.done.slice(-LIMIT);
    const undone = j.undone.slice(-LIMIT);
    let text = JSON.stringify({ ...j, done, undone });
    while (text.length > MAX_BYTES && done.length > 0) {
      done = done.slice(Math.ceil(done.length / 4)); // drop the oldest quarter until it fits
      text = JSON.stringify({ ...j, done, undone });
    }
    if (text.length > MAX_BYTES) { storage.removeItem(key(j.world)); return false; }
    storage.setItem(key(j.world), text);
    return true;
  } catch { return false; }
}

export function loadJournal(world: string, storage: Pick<Storage, "getItem"> = localStorage): Journal {
  try { return parseJournal(storage.getItem(key(world)), world); } catch { return parseJournal(null, world); }
}
