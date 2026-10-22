import {
  Message,
  addToOutbox,
  clearMessages,
  deleteMessage,
  deleteMessagesFromId,
  getLastUserMessage,
  getOutboxItems,
  initChatDb,
  insertMessage,
  listMessages,
  removeOutboxItem,
  updateMessage,
} from './chat';


interface SqliteStatement {
  run(...params: unknown[]): { lastInsertRowid?: number | bigint; lastInsertRowId?: number | bigint; changes?: number | bigint };
  all(...params: unknown[]): Record<string, unknown>[];
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

jest.mock('expo-sqlite', () => {
  // Node's built-in sqlite is used as the in-memory engine for this test.
  const { DatabaseSync } = jest.requireActual('node:sqlite') as {
    DatabaseSync: new (path: string) => SqliteDatabase;
  };
  const database = new DatabaseSync(':memory:');

  return {
    openDatabaseSync: () => ({
      execSync: (sql: string): void => {
        database.exec(sql);
      },
      runSync: (sql: string, params: (string | number | null)[] = []) => {
        const statement = database.prepare(sql);
        const result = statement.run(...params);
        const lastInsertRowId = result.lastInsertRowid ?? result.lastInsertRowId ?? 0;
        return { lastInsertRowId: Number(lastInsertRowId), changes: Number(result.changes ?? 0) };
      },
      getAllSync: (sql: string, params: (string | number | null)[] = []) => {
        const statement = database.prepare(sql);
        return statement.all(...params).map((row) => ({ ...row }));
      },
    }),
  };
});

function makeMessage(overrides: Partial<Omit<Message, 'id'>> = {}): Omit<Message, 'id'> {
  return {
    bot_slug: 'jasper',
    role: 'user',
    from_slug: 'you',
    text: 'hello',
    ts: 1000,
    status: 'sent',
    ...overrides,
  };
}

describe('chat database', () => {
  beforeAll(() => {
    initChatDb();
  });

  beforeEach(() => {
    clearMessages('jasper');
    clearMessages('analyst');
  });

  it('round trips a message', () => {
    const id = insertMessage(makeMessage({ text: 'hi there' }));
    const messages = listMessages('jasper', 10);

    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(id);
    expect(messages[0].text).toBe('hi there');
    expect(messages[0].role).toBe('user');
    expect(messages[0].status).toBe('sent');
  });

  it('returns messages oldest first', () => {
    insertMessage(makeMessage({ text: 'first', ts: 1 }));
    insertMessage(makeMessage({ text: 'second', ts: 2 }));
    insertMessage(makeMessage({ text: 'third', ts: 3 }));

    expect(listMessages('jasper', 10).map((m) => m.text)).toEqual(['first', 'second', 'third']);
  });

  it('honours the limit', () => {
    insertMessage(makeMessage({ text: 'first', ts: 1 }));
    insertMessage(makeMessage({ text: 'second', ts: 2 }));
    insertMessage(makeMessage({ text: 'third', ts: 3 }));

    expect(listMessages('jasper', 2).map((m) => m.text)).toEqual(['second', 'third']);
  });

  it('honours the before timestamp', () => {
    insertMessage(makeMessage({ text: 'first', ts: 1 }));
    insertMessage(makeMessage({ text: 'second', ts: 2 }));

    expect(listMessages('jasper', 10, 2).map((m) => m.text)).toEqual(['first']);
  });

  it('keeps conversations apart', () => {
    insertMessage(makeMessage({ bot_slug: 'jasper', text: 'for jasper' }));
    insertMessage(makeMessage({ bot_slug: 'analyst', text: 'for analyst' }));

    expect(listMessages('jasper', 10)).toHaveLength(1);
    expect(listMessages('analyst', 10)[0].text).toBe('for analyst');
  });

  it('updates a message', () => {
    const id = insertMessage(makeMessage({ text: 'before' }));
    updateMessage(id, { text: 'after', status: 'done' });

    const [message] = listMessages('jasper', 10);
    expect(message.text).toBe('after');
    expect(message.status).toBe('done');
  });

  it('ignores unknown columns on update', () => {
    const id = insertMessage(makeMessage({ text: 'keep' }));
    updateMessage(id, { text: 'changed' } as Partial<Omit<Message, 'id'>>);

    expect(listMessages('jasper', 10)[0].text).toBe('changed');
  });

  it('stores the optional json columns', () => {
    insertMessage(
      makeMessage({
        role: 'tool',
        tool_json: '{"label":"db.query"}',
        attachments_json: '{"name":"a.txt"}',
      })
    );

    const [message] = listMessages('jasper', 10);
    expect(message.tool_json).toBe('{"label":"db.query"}');
    expect(message.attachments_json).toBe('{"name":"a.txt"}');
  });

  it('deletes a single message', () => {
    const id = insertMessage(makeMessage({ text: 'bye' }));
    deleteMessage(id);

    expect(listMessages('jasper', 10)).toHaveLength(0);
  });

  it('deletes a message and everything after it', () => {
    insertMessage(makeMessage({ text: 'one', ts: 1 }));
    const second = insertMessage(makeMessage({ text: 'two', ts: 2 }));
    insertMessage(makeMessage({ text: 'three', ts: 3 }));
    insertMessage(makeMessage({ bot_slug: 'analyst', text: 'other bot', ts: 4 }));

    deleteMessagesFromId('jasper', second);

    expect(listMessages('jasper', 10).map((m) => m.text)).toEqual(['one']);
    expect(listMessages('analyst', 10)).toHaveLength(1);
  });

  it('clears only the given conversation', () => {
    insertMessage(makeMessage({ bot_slug: 'jasper' }));
    insertMessage(makeMessage({ bot_slug: 'analyst' }));

    clearMessages('jasper');

    expect(listMessages('jasper', 10)).toHaveLength(0);
    expect(listMessages('analyst', 10)).toHaveLength(1);
  });

  it('finds the last user message', () => {
    insertMessage(makeMessage({ role: 'user', text: 'question' }));
    insertMessage(makeMessage({ role: 'assistant', from_slug: 'jasper', text: 'answer' }));

    expect(getLastUserMessage('jasper')?.text).toBe('question');
  });

  it('stores outbox items', () => {
    addToOutbox('jasper', { text: 'queued' });

    const items = getOutboxItems();
    expect(items).toHaveLength(1);
    expect(items[0].bot_slug).toBe('jasper');
    expect(JSON.parse(items[0].payload_json)).toEqual({ text: 'queued' });

    removeOutboxItem(items[0].id);
    expect(getOutboxItems()).toHaveLength(0);
  });
});
