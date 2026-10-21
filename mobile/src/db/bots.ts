import { openDatabaseSync } from 'expo-sqlite';
import { BotGroup, Bot } from '@/api/types';

const db = openDatabaseSync('jasper.db');

export function initBotsDb(): void {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS bot_groups (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS bots (
      slug TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      position TEXT NOT NULL,
      department TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      score INTEGER,
      grade TEXT NOT NULL,
      group_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES bot_groups(id)
    );
  `);
}

export function saveBotGroups(groups: BotGroup[]): void {
  const now = Date.now();
  db.execSync('BEGIN');
  try {
    for (const group of groups) {
      db.runSync(
        `INSERT OR REPLACE INTO bot_groups (id, label, updated_at) VALUES (?, ?, ?)`,
        [group.id, group.label, now]
      );
      for (const bot of group.bots) {
        db.runSync(
          `INSERT OR REPLACE INTO bots (slug, display_name, position, department, enabled, score, grade, group_id, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [bot.slug, bot.display_name, bot.position, bot.department, bot.enabled ? 1 : 0, bot.score ?? null, bot.grade, group.id, now]
        );
      }
    }
    db.execSync('COMMIT');
  } catch (e) {
    db.execSync('ROLLBACK');
    throw e;
  }
}

export function loadBotGroups(): BotGroup[] {
  const groups = db.getAllSync<{ id: string; label: string }>(
    `SELECT id, label FROM bot_groups ORDER BY id`
  );
  const result: BotGroup[] = [];
  for (const group of groups) {
    const bots = db.getAllSync<{
      slug: string;
      display_name: string;
      position: string;
      department: string;
      enabled: number;
      score: number | null;
      grade: string;
    }>(
      `SELECT slug, display_name, position, department, enabled, score, grade FROM bots WHERE group_id = ? ORDER BY display_name`,
      [group.id]
    );
    result.push({
      id: group.id,
      label: group.label,
      bots: bots.map((b) => ({
        slug: b.slug,
        display_name: b.display_name,
        position: b.position,
        department: b.department,
        enabled: b.enabled === 1,
        score: b.score,
        grade: b.grade,
      })),
    });
  }
  return result;
}

export function clearBotCache(): void {
  db.execSync('DELETE FROM bots; DELETE FROM bot_groups;');
}