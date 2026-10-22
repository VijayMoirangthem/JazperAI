import { openDatabaseSync } from 'expo-sqlite';

const db = openDatabaseSync('jasper.db');

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'ui';
export type MessageStatus = 'sending' | 'sent' | 'streaming' | 'done' | 'error';

export interface Message {
  id: number;
  bot_slug: string;
  role: MessageRole;
  from_slug: string;
  text: string;
  ts: number;
  status: MessageStatus;
  tool_json?: string;
  ui_json?: string;
  attachments_json?: string;
}

export interface OutboxItem {
  id: number;
  bot_slug: string;
  payload_json: string;
  created_at: number;
}

/** Columns that may be written by updateMessage. Anything else is ignored. */
const UPDATABLE_COLUMNS = ['bot_slug', 'role', 'from_slug', 'text', 'ts', 'status', 'tool_json', 'ui_json', 'attachments_json'];

export function initChatDb(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_slug TEXT NOT NULL,
      role TEXT NOT NULL,
      from_slug TEXT NOT NULL,
      text TEXT NOT NULL,
      ts INTEGER NOT NULL,
      status TEXT NOT NULL,
      tool_json TEXT,
      ui_json TEXT,
      attachments_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_bot_ts ON messages(bot_slug, ts);

    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_slug TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
}

export function listMessages(botSlug: string, limit: number, beforeTs?: number): Message[] {
  let query = 'SELECT * FROM messages WHERE bot_slug = ?';
  const params: (string | number)[] = [botSlug];

  if (beforeTs !== undefined) {
    query += ' AND ts < ?';
    params.push(beforeTs);
  }

  query += ' ORDER BY ts DESC LIMIT ?';
  params.push(limit);

  const rows = db.getAllSync<Message>(query, params);
  return rows.reverse();
}

export function insertMessage(message: Omit<Message, 'id'>): number {
  const result = db.runSync(
    `INSERT INTO messages (bot_slug, role, from_slug, text, ts, status, tool_json, ui_json, attachments_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.bot_slug,
      message.role,
      message.from_slug,
      message.text,
      message.ts,
      message.status,
      message.tool_json ?? null,
      message.ui_json ?? null,
      message.attachments_json ?? null,
    ]
  );
  return result.lastInsertRowId;
}

export function updateMessage(id: number, updates: Partial<Omit<Message, 'id'>>): void {
  const fields: string[] = [];
  const values: (string | number | null)[] = [];

  for (const key of UPDATABLE_COLUMNS) {
    const value = updates[key as keyof Omit<Message, 'id'>];
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value as string | number | null);
    }
  }

  if (fields.length === 0) return;

  values.push(id);
  db.runSync(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`, values);
}

export function deleteMessage(id: number): void {
  db.runSync('DELETE FROM messages WHERE id = ?', [id]);
}

/** Removes one message and everything that came after it in the same conversation. */
export function deleteMessagesFromId(botSlug: string, fromId: number): void {
  db.runSync('DELETE FROM messages WHERE bot_slug = ? AND id >= ?', [botSlug, fromId]);
}

export function clearMessages(botSlug: string): void {
  db.runSync('DELETE FROM messages WHERE bot_slug = ?', [botSlug]);
}

export function getLastUserMessage(botSlug: string): Message | null {
  const rows = db.getAllSync<Message>(
    "SELECT * FROM messages WHERE bot_slug = ? AND role = 'user' ORDER BY id DESC LIMIT 1",
    [botSlug]
  );
  return rows[0] ?? null;
}

export function addToOutbox(botSlug: string, payload: unknown): void {
  db.runSync('INSERT INTO outbox (bot_slug, payload_json, created_at) VALUES (?, ?, ?)', [
    botSlug,
    JSON.stringify(payload),
    Date.now(),
  ]);
}

export function getOutboxItems(): OutboxItem[] {
  return db.getAllSync<OutboxItem>('SELECT * FROM outbox ORDER BY created_at ASC');
}

export function removeOutboxItem(id: number): void {
  db.runSync('DELETE FROM outbox WHERE id = ?', [id]);
}
