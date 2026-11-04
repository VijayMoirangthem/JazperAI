import { openDatabaseSync } from 'expo-sqlite';
import { initChatDb } from './chat';

const db = openDatabaseSync('jasper.db');

let ready = false;
let hasFts = false;

export interface BotMeta {
  slug: string;
  pinned: boolean;
  muted: boolean;
  lastReadId: number;
  lastAt: number;
  lastPreview: string;
  lastRole: string;
  lastBotId: number;
  unread: boolean;
}

export interface SearchHit {
  id: number;
  bot_slug: string;
  text: string;
  ts: number;
  role: string;
}

/** Creates the V2 tables and triggers. Safe to call many times. */
export function initMetaDb(): void {
  if (ready) return;
  initChatDb();
  db.execSync(`
    CREATE TABLE IF NOT EXISTS bot_meta (
      slug TEXT PRIMARY KEY,
      pinned INTEGER NOT NULL DEFAULT 0,
      muted INTEGER NOT NULL DEFAULT 0,
      lastReadId INTEGER NOT NULL DEFAULT 0,
      lastAt INTEGER NOT NULL DEFAULT 0,
      lastPreview TEXT NOT NULL DEFAULT '',
      lastRole TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS message_reactions (
      message_id INTEGER PRIMARY KEY,
      emoji TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      bot_slug TEXT PRIMARY KEY,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recent_searches (
      query TEXT PRIMARY KEY,
      ts INTEGER NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS trg_meta_insert AFTER INSERT ON messages
    WHEN new.role IN ('user','assistant')
    BEGIN
      INSERT INTO bot_meta(slug, lastAt, lastPreview, lastRole) VALUES (new.bot_slug, new.ts, substr(new.text,1,240), new.role)
      ON CONFLICT(slug) DO UPDATE SET lastAt=new.ts, lastPreview=substr(new.text,1,240), lastRole=new.role;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_meta_update AFTER UPDATE OF text ON messages
    WHEN new.role IN ('user','assistant') AND new.id = (SELECT MAX(id) FROM messages WHERE bot_slug = new.bot_slug AND role IN ('user','assistant'))
    BEGIN
      UPDATE bot_meta SET lastPreview=substr(new.text,1,240), lastRole=new.role WHERE slug=new.bot_slug;
    END;
    CREATE TRIGGER IF NOT EXISTS trg_reaction_cleanup AFTER DELETE ON messages
    BEGIN
      DELETE FROM message_reactions WHERE message_id = old.id;
    END;
  `);
  try {
    db.execSync(`
      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(text, content='messages', content_rowid='id');
      CREATE TRIGGER IF NOT EXISTS trg_fts_insert AFTER INSERT ON messages WHEN new.role IN ('user','assistant')
      BEGIN INSERT INTO message_fts(rowid, text) VALUES (new.id, new.text); END;
      CREATE TRIGGER IF NOT EXISTS trg_fts_delete AFTER DELETE ON messages WHEN old.role IN ('user','assistant')
      BEGIN INSERT INTO message_fts(message_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
      CREATE TRIGGER IF NOT EXISTS trg_fts_update AFTER UPDATE OF text ON messages WHEN new.role IN ('user','assistant')
      BEGIN
        INSERT INTO message_fts(message_fts, rowid, text) VALUES ('delete', old.id, old.text);
        INSERT INTO message_fts(rowid, text) VALUES (new.id, new.text);
      END;
    `);
    const empty = db.getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM message_fts_docsize');
    if (!empty || empty.n === 0) db.execSync(`INSERT INTO message_fts(message_fts) VALUES('rebuild')`);
    hasFts = true;
  } catch {
    hasFts = false; // search falls back to LIKE
  }
  // Seed meta rows for chats that existed before V2.
  db.execSync(`
    INSERT OR IGNORE INTO bot_meta(slug, lastAt, lastPreview, lastRole)
    SELECT m.bot_slug, m.ts, substr(m.text,1,240), m.role FROM messages m
    WHERE m.role IN ('user','assistant') AND m.id = (SELECT MAX(id) FROM messages WHERE bot_slug = m.bot_slug AND role IN ('user','assistant'));
  `);
  ready = true;
}

interface MetaRow {
  slug: string;
  pinned: number;
  muted: number;
  lastReadId: number;
  lastAt: number;
  lastPreview: string;
  lastRole: string;
  lastBotId: number | null;
}

export function listBotMeta(): BotMeta[] {
  initMetaDb();
  const rows = db.getAllSync<MetaRow>(`
    SELECT b.slug, b.pinned, b.muted, b.lastReadId, b.lastAt, b.lastPreview, b.lastRole,
      (SELECT MAX(id) FROM messages WHERE bot_slug = b.slug AND role = 'assistant') AS lastBotId
    FROM bot_meta b`);
  return rows.map((r) => ({
    slug: r.slug,
    pinned: r.pinned === 1,
    muted: r.muted === 1,
    lastReadId: r.lastReadId,
    lastAt: r.lastAt,
    lastPreview: r.lastPreview,
    lastRole: r.lastRole,
    lastBotId: r.lastBotId ?? 0,
    unread: (r.lastBotId ?? 0) > r.lastReadId,
  }));
}

function ensureRow(slug: string): void {
  db.runSync('INSERT OR IGNORE INTO bot_meta(slug) VALUES (?)', [slug]);
}

export function setPinned(slug: string, pinned: boolean): void {
  initMetaDb();
  ensureRow(slug);
  db.runSync('UPDATE bot_meta SET pinned=? WHERE slug=?', [pinned ? 1 : 0, slug]);
}

export function setMuted(slug: string, muted: boolean): void {
  initMetaDb();
  ensureRow(slug);
  db.runSync('UPDATE bot_meta SET muted=? WHERE slug=?', [muted ? 1 : 0, slug]);
}

export function markRead(slug: string): void {
  initMetaDb();
  ensureRow(slug);
  db.runSync(
    'UPDATE bot_meta SET lastReadId = COALESCE((SELECT MAX(id) FROM messages WHERE bot_slug = ?), 0) WHERE slug = ?',
    [slug, slug]
  );
}

export function markUnread(slug: string): void {
  initMetaDb();
  ensureRow(slug);
  db.runSync(
    `UPDATE bot_meta SET lastReadId = MAX(0, COALESCE((SELECT MAX(id) FROM messages WHERE bot_slug = ? AND role = 'assistant'), 1) - 1) WHERE slug = ?`,
    [slug, slug]
  );
}

export function firstUnreadId(slug: string): number | null {
  initMetaDb();
  const row = db.getFirstSync<{ id: number | null }>(
    `SELECT MIN(id) AS id FROM messages WHERE bot_slug = ? AND role = 'assistant' AND id > COALESCE((SELECT lastReadId FROM bot_meta WHERE slug = ?), 0)`,
    [slug, slug]
  );
  return row?.id ?? null;
}

export function unreadTotal(): number {
  return listBotMeta().filter((m) => m.unread && !m.muted).length;
}

// Reactions -----------------------------------------------------------------------------------------
export function listReactions(slug: string): Record<number, string> {
  initMetaDb();
  const rows = db.getAllSync<{ message_id: number; emoji: string }>(
    'SELECT r.message_id, r.emoji FROM message_reactions r JOIN messages m ON m.id = r.message_id WHERE m.bot_slug = ?',
    [slug]
  );
  const out: Record<number, string> = {};
  for (const row of rows) out[row.message_id] = row.emoji;
  return out;
}

export function setReaction(messageId: number, emoji: string | null): void {
  initMetaDb();
  if (emoji) db.runSync('INSERT OR REPLACE INTO message_reactions(message_id, emoji) VALUES (?, ?)', [messageId, emoji]);
  else db.runSync('DELETE FROM message_reactions WHERE message_id = ?', [messageId]);
}

// Drafts --------------------------------------------------------------------------------------------
export function loadDraft(slug: string): string {
  initMetaDb();
  return db.getFirstSync<{ text: string }>('SELECT text FROM drafts WHERE bot_slug = ?', [slug])?.text ?? '';
}

export function saveDraft(slug: string, text: string): void {
  initMetaDb();
  if (text) db.runSync('INSERT OR REPLACE INTO drafts(bot_slug, text) VALUES (?, ?)', [slug, text]);
  else db.runSync('DELETE FROM drafts WHERE bot_slug = ?', [slug]);
}

// Search --------------------------------------------------------------------------------------------
/** Turns free text into a safe FTS5 query: every word quoted, prefix match on the last one. */
export function buildFtsQuery(input: string): string {
  const words = input
    .replace(/["'*^():\-+~<>{}[\]\\]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) return '';
  return words.map((w, i) => (i === words.length - 1 ? `"${w}"*` : `"${w}"`)).join(' ');
}

export function searchMessages(query: string, limit = 40, botSlug?: string): SearchHit[] {
  initMetaDb();
  const q = query.trim();
  if (!q) return [];
  const scope = botSlug ? ' AND m.bot_slug = ?' : '';
  const scopeParams = botSlug ? [botSlug] : [];
  if (hasFts) {
    const fts = buildFtsQuery(q);
    if (!fts) return [];
    try {
      return db.getAllSync<SearchHit>(
        `SELECT m.id, m.bot_slug, m.text, m.ts, m.role FROM message_fts f JOIN messages m ON m.id = f.rowid
         WHERE message_fts MATCH ?${scope} ORDER BY m.ts DESC LIMIT ?`,
        [fts, ...scopeParams, limit]
      );
    } catch {
      // fall through to LIKE
    }
  }
  const like = `%${q.replace(/[%_]/g, ' ')}%`;
  return db.getAllSync<SearchHit>(
    `SELECT m.id, m.bot_slug, m.text, m.ts, m.role FROM messages m
     WHERE m.role IN ('user','assistant') AND m.text LIKE ?${scope} ORDER BY m.ts DESC LIMIT ?`,
    [like, ...scopeParams, limit]
  );
}

export function listRecentSearches(): string[] {
  initMetaDb();
  return db.getAllSync<{ query: string }>('SELECT query FROM recent_searches ORDER BY ts DESC LIMIT 8').map((r) => r.query);
}

export function addRecentSearch(query: string): void {
  initMetaDb();
  const q = query.trim();
  if (q.length < 2) return;
  db.runSync('INSERT OR REPLACE INTO recent_searches(query, ts) VALUES (?, ?)', [q, Date.now()]);
}

export function clearRecentSearches(): void {
  initMetaDb();
  db.runSync('DELETE FROM recent_searches');
}

/** Removes every chat from this phone (used by "Erase chats on this phone"). */
export function eraseAllChats(): void {
  initMetaDb();
  db.execSync(`
    DELETE FROM messages;
    DELETE FROM outbox;
    DELETE FROM drafts;
    DELETE FROM message_reactions;
    UPDATE bot_meta SET lastAt = 0, lastPreview = '', lastRole = '', lastReadId = 0;
  `);
}
