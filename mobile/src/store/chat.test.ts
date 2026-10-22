import { Message, deleteMessage as deleteMessageRow, deleteMessagesFromId, insertMessage } from '@/db/chat';
import { streamChat } from '@/api/ndjson';
import { ChatEvent } from '@/api/types';
import { applyChatEvent, buildHistory, getToolPayload, useChat } from './chat';

jest.mock('@/db/chat', () => {
  let nextId = 0;
  return {
    initChatDb: jest.fn(),
    listMessages: jest.fn(() => []),
    insertMessage: jest.fn(() => {
      nextId += 1;
      return nextId;
    }),
    updateMessage: jest.fn(),
    deleteMessage: jest.fn(),
    deleteMessagesFromId: jest.fn(),
  };
});

jest.mock('@/api/ndjson', () => ({
  streamChat: jest.fn(),
}));

jest.mock('@/auth/useAuth', () => ({
  useAuth: {
    getState: () => ({
      accessToken: 'test-token',
      deviceId: 'test-device',
      deviceSecret: 'test-secret',
      credentials: {
        baseUrl: 'https://api.example.com',
        deviceId: 'test-device',
        deviceSecret: 'test-secret',
      },
    }),
  },
}));

const fs = jest.requireActual('node:fs') as {
  readFileSync(path: string, encoding: 'utf8'): string;
  existsSync(path: string): boolean;
};
const pathModule = jest.requireActual('node:path') as {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
};
const processModule = jest.requireActual('node:process') as { cwd(): string };

function readFixture(name: string): string {
  let dir = processModule.cwd();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = pathModule.join(dir, 'src', 'api', '__fixtures__', name);
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
    const parent = pathModule.resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Fixture ${name} was not found`);
}

function botMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 1,
    bot_slug: 'jasper',
    role: 'assistant',
    from_slug: 'jasper',
    text: '',
    ts: 1,
    status: 'streaming',
    ...overrides,
  };
}

function userMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 10,
    bot_slug: 'jasper',
    role: 'user',
    from_slug: 'you',
    text: 'hello',
    ts: 1,
    status: 'sent',
    ...overrides,
  };
}

async function emptyStream(): Promise<AsyncGenerator<ChatEvent, void, unknown>> {
  return (async function* noEvents(): AsyncGenerator<ChatEvent, void, unknown> {
    return;
  })();
}

describe('applyChatEvent', () => {
  it('creates a streaming bot message on speaker', () => {
    const result = applyChatEvent([], { t: 'speaker', slug: 'jasper' }, 'jasper');

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('assistant');
    expect(result[0].from_slug).toBe('jasper');
    expect(result[0].status).toBe('streaming');
  });

  it('appends deltas to the current bot message', () => {
    const started = applyChatEvent([], { t: 'speaker', slug: 'jasper' }, 'jasper');
    const withText = applyChatEvent(started, { t: 'delta', slug: 'jasper', text: 'Hello' }, 'jasper');
    const withMore = applyChatEvent(withText, { t: 'delta', slug: 'jasper', text: ' there' }, 'jasper');

    expect(withMore).toHaveLength(1);
    expect(withMore[0].text).toBe('Hello there');
  });

  it('creates a bot message when a delta arrives without a speaker', () => {
    const result = applyChatEvent([], { t: 'delta', slug: 'jasper', text: 'Hi' }, 'jasper');

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Hi');
    expect(result[0].status).toBe('streaming');
  });

  it('keeps one bubble when the same bot speaks again', () => {
    const started = applyChatEvent([], { t: 'speaker', slug: 'jasper' }, 'jasper');
    const result = applyChatEvent(started, { t: 'speaker', slug: 'jasper' }, 'jasper');

    expect(result).toHaveLength(1);
  });

  it('starts a new bubble when a speaker follows a tool chip', () => {
    let messages = applyChatEvent([], { t: 'speaker', slug: 'jasper' }, 'jasper');
    messages = applyChatEvent(messages, { t: 'delta', slug: 'jasper', text: 'first' }, 'jasper');
    messages = applyChatEvent(
      messages,
      { t: 'tool', slug: 'jasper', name: 'query', label: 'db.query', status: 'running' },
      'jasper'
    );
    messages = applyChatEvent(messages, { t: 'speaker', slug: 'jasper' }, 'jasper');

    expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(2);
  });

  it('puts the text after a tool chip into a new bubble', () => {
    let messages = applyChatEvent([], { t: 'speaker', slug: 'jasper' }, 'jasper');
    messages = applyChatEvent(messages, { t: 'delta', slug: 'jasper', text: 'first' }, 'jasper');
    messages = applyChatEvent(
      messages,
      { t: 'tool', slug: 'jasper', name: 'query', label: 'db.query', status: 'running' },
      'jasper'
    );
    messages = applyChatEvent(messages, { t: 'delta', slug: 'jasper', text: 'second' }, 'jasper');

    const bubbles = messages.filter((message) => message.role === 'assistant');
    expect(bubbles.map((bubble) => bubble.text)).toEqual(['first', 'second']);
  });

  it('creates a tool chip and upserts it by label', () => {
    const running = applyChatEvent(
      [],
      { t: 'tool', slug: 'jasper', name: 'query', label: 'db.query', status: 'running' },
      'jasper'
    );
    expect(running).toHaveLength(1);
    expect(running[0].role).toBe('tool');
    expect(getToolPayload(running[0])?.status).toBe('running');

    const finished = applyChatEvent(
      running,
      { t: 'tool', slug: 'jasper', name: 'query', label: 'db.query', status: 'ok', result: { rows: 2 } },
      'jasper'
    );
    expect(finished).toHaveLength(1);
    expect(getToolPayload(finished[0])?.status).toBe('ok');
    expect(getToolPayload(finished[0])?.result).toEqual({ rows: 2 });
  });

  it('keeps the untrusted flag on a tool chip', () => {
    const result = applyChatEvent(
      [],
      { t: 'tool', slug: 'jasper', name: 'query', label: 'db.query', status: 'ok', untrusted: true },
      'jasper'
    );

    expect(getToolPayload(result[0])?.untrusted).toBe(true);
  });

  it('inserts a card message for a ui event', () => {
    const result = applyChatEvent(
      [],
      {
        t: 'ui',
        slug: 'jasper',
        kind: 'suggestions',
        connector: 'jira',
        items: [{ name: 'Create ticket', why: 'Asked for', status: 'pending' }],
      },
      'jasper'
    );

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('ui');
    expect(result[0].ui_json).toContain('suggestions');
  });

  it('inserts a divider for a phase event', () => {
    const result = applyChatEvent([], { t: 'phase', text: '--- Meeting started ---' }, 'jasper');

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('system');
    expect(result[0].text).toBe('--- Meeting started ---');
  });

  it('closes the bot message on done', () => {
    let messages = applyChatEvent([], { t: 'speaker', slug: 'jasper' }, 'jasper');
    messages = applyChatEvent(messages, { t: 'delta', slug: 'jasper', text: 'Hi' }, 'jasper');
    messages = applyChatEvent(messages, { t: 'done', slug: 'jasper', usage: {} }, 'jasper');

    expect(messages[0].status).toBe('done');
  });

  it('shows an error as a red system message', () => {
    const result = applyChatEvent([], { t: 'error', slug: 'jasper', message: 'Connection timeout' }, 'jasper');

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('system');
    expect(result[0].status).toBe('error');
    expect(result[0].text).toBe('Connection timeout');
  });

  it('ignores unknown events', () => {
    const messages = [userMessage()];
    const result = applyChatEvent(messages, { t: 'route', slugs: ['jasper'], source: 'router', confidence: 1 }, 'jasper');

    expect(result).toBe(messages);
  });

  it('does not change the messages it was given', () => {
    const messages = [userMessage()];
    applyChatEvent(messages, { t: 'delta', slug: 'jasper', text: 'x' }, 'jasper');

    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe('hello');
  });
});

describe('applyChatEvent with the recorded stream', () => {
  it('rebuilds the conversation from the fixture', () => {
    const lines = readFixture('chat.ndjson')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    let messages: Message[] = [];
    for (const line of lines) {
      messages = applyChatEvent(messages, JSON.parse(line) as ChatEvent, 'jasper');
    }

    expect(messages.map((message) => message.role)).toEqual([
      'assistant',
      'assistant',
      'tool',
      'assistant',
      'ui',
      'system',
      'system',
    ]);

    expect(messages[0].text).toBe('Hello! How can I help you today?');
    expect(messages[0].status).toBe('done');
    expect(messages[1].text).toBe('Looking at the data...');
    expect(messages[2].text).toBe('db.query');
    expect(messages[3].text).toBe('Found 5 results.');
    expect(messages[5].text).toBe('--- Meeting started ---');
    expect(messages[6].status).toBe('error');
    expect(messages[6].text).toBe('Connection timeout');
  });
});

describe('buildHistory', () => {
  it('keeps user and assistant messages only', () => {
    const messages = [
      userMessage({ id: 1, text: 'question' }),
      botMessage({ id: 2, text: 'answer', status: 'done' }),
      { ...botMessage({ id: 3 }), role: 'tool' as const, text: 'db.query' },
      { ...botMessage({ id: 4 }), role: 'ui' as const, text: 'jira' },
    ];

    expect(buildHistory(messages)).toEqual([
      { role: 'user', content: 'question' },
      { role: 'assistant', content: 'answer' },
    ]);
  });

  it('keeps only the last 20 messages', () => {
    const messages = Array.from({ length: 25 }, (_, index) =>
      userMessage({ id: index + 1, text: `message ${index}` })
    );

    const history = buildHistory(messages);

    expect(history).toHaveLength(20);
    expect(history[0].content).toBe('message 5');
    expect(history[19].content).toBe('message 24');
  });

  it('returns nothing when there is no conversation', () => {
    expect(buildHistory([])).toEqual([]);
  });
});

describe('chat store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChat.setState({ messagesByBot: {}, streamingByBot: {}, errorByBot: {}, thumbsByBot: {} });
    (streamChat as jest.Mock).mockResolvedValue(emptyStream());
  });

  it('stores the user message and asks the bot', async () => {
    await useChat.getState().send('jasper', 'hello', []);

    expect(insertMessage).toHaveBeenCalledTimes(1);
    expect(useChat.getState().messagesByBot.jasper).toHaveLength(1);
    expect(useChat.getState().messagesByBot.jasper[0].role).toBe('user');
    expect(useChat.getState().messagesByBot.jasper[0].text).toBe('hello');

    const body = (streamChat as jest.Mock).mock.calls[0][1];
    expect(body.text).toBe('hello');
    expect(body.slug).toBe('jasper');
    expect(body.history).toEqual([]);
  });

  it('sends attachment-only messages without local-only fields', async () => {
    await useChat.getState().send('jasper', '', [
      { name: 'scan.png', mime: 'image/png', uri: 'file:///scan.png' },
    ]);

    const body = (streamChat as jest.Mock).mock.calls[0][1];
    expect(body.text).toBe('');
    expect(body.attachments).toEqual([{ name: 'scan.png', mime: 'image/png' }]);
    expect(useChat.getState().messagesByBot.jasper[0].attachments_json).toContain('scan.png');
  });

  it('sends the previous conversation as history', async () => {
    useChat.setState({
      messagesByBot: {
        jasper: [userMessage({ id: 1, text: 'first' }), botMessage({ id: 2, text: 'answer', status: 'done' })],
      },
    });

    await useChat.getState().send('jasper', 'second', []);

    const body = (streamChat as jest.Mock).mock.calls[0][1];
    expect(body.history).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
    ]);
  });

  it('stores the streamed answer', async () => {
    (streamChat as jest.Mock).mockResolvedValue(
      (async function* answer(): AsyncGenerator<ChatEvent, void, unknown> {
        yield { t: 'speaker', slug: 'jasper' };
        yield { t: 'delta', slug: 'jasper', text: 'Hi there' };
        yield { t: 'done', slug: 'jasper', usage: {} };
      })()
    );

    await useChat.getState().send('jasper', 'hello', []);

    const messages = useChat.getState().messagesByBot.jasper;
    expect(messages).toHaveLength(2);
    expect(messages[1].role).toBe('assistant');
    expect(messages[1].text).toBe('Hi there');
    expect(messages[1].status).toBe('done');
    expect(useChat.getState().streamingByBot.jasper).toBe(false);
  });

  it('shows the error when the request fails', async () => {
    (streamChat as jest.Mock).mockRejectedValue(new Error('Network request failed'));

    await useChat.getState().send('jasper', 'hello', []);

    expect(useChat.getState().errorByBot.jasper).toBe('Network request failed');
    expect(useChat.getState().streamingByBot.jasper).toBe(false);
  });

  it('editing a message removes it and everything after it', () => {
    useChat.setState({
      messagesByBot: {
        jasper: [
          userMessage({ id: 1, text: 'first' }),
          botMessage({ id: 2, text: 'answer', status: 'done' }),
          userMessage({ id: 3, text: 'second' }),
        ],
      },
    });

    const text = useChat.getState().editMessage('jasper', 2);

    expect(text).toBe('answer');
    expect(useChat.getState().messagesByBot.jasper).toHaveLength(1);
    expect(deleteMessagesFromId).toHaveBeenCalledWith('jasper', 2);
  });

  it('editing a message that is not there changes nothing', () => {
    useChat.setState({ messagesByBot: { jasper: [userMessage({ id: 1 })] } });

    expect(useChat.getState().editMessage('jasper', 99)).toBeNull();
    expect(useChat.getState().messagesByBot.jasper).toHaveLength(1);
  });

  it('deleting a message removes only that message', () => {
    useChat.setState({
      messagesByBot: {
        jasper: [userMessage({ id: 1 }), botMessage({ id: 2, text: 'answer', status: 'done' })],
      },
    });

    useChat.getState().deleteMessage('jasper', 1);

    expect(useChat.getState().messagesByBot.jasper).toHaveLength(1);
    expect(deleteMessageRow).toHaveBeenCalledWith(1);
  });

  it('regenerating removes the last bot answer and asks again', async () => {
    useChat.setState({
      messagesByBot: {
        jasper: [userMessage({ id: 1, text: 'question' }), botMessage({ id: 2, text: 'old answer', status: 'done' })],
      },
    });

    await useChat.getState().regenerate('jasper');

    expect(deleteMessageRow).toHaveBeenCalledWith(2);
    const body = (streamChat as jest.Mock).mock.calls[0][1];
    expect(body.text).toBe('question');
    expect(body.history).toEqual([]);
  });

  it('retrying resends the last user message without duplicating it', async () => {
    useChat.setState({
      messagesByBot: {
        jasper: [
          userMessage({ id: 1, text: 'question' }),
          botMessage({ id: 2, text: 'broken answer', status: 'error' }),
        ],
      },
    });

    await useChat.getState().retry('jasper');

    const body = (streamChat as jest.Mock).mock.calls[0][1];
    expect(body.text).toBe('question');
    expect(useChat.getState().messagesByBot.jasper).toHaveLength(1);
  });

  it('stores the thumbs locally', () => {
    useChat.getState().setThumbs('jasper', 5, true);

    expect(useChat.getState().thumbsByBot.jasper).toEqual({ 5: true });
  });
});
