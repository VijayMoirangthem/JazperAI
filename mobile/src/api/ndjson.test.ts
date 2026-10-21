import { readNdjson } from './ndjson';
import { ChatEvent } from './types';

function createMockResponse(chunks: Uint8Array[]): Response {
  let index = 0;
  const reader = {
    read: async () => {
      if (index < chunks.length) {
        return { done: false, value: chunks[index++] };
      }
      return { done: true, value: undefined };
    },
    releaseLock: jest.fn(),
  };

  return {
    ok: true,
    body: {
      getReader: () => reader,
    },
  } as unknown as Response;
}

describe('readNdjson', () => {
  it('parses complete lines', async () => {
    const chunks = [
      new TextEncoder().encode('{"t":"speaker","slug":"jasper"}\n'),
      new TextEncoder().encode('{"t":"delta","slug":"jasper","text":"Hello"}\n'),
      new TextEncoder().encode('{"t":"done","slug":"jasper","usage":{}}\n'),
    ];

    const response = createMockResponse(chunks);
    const events: ChatEvent[] = [];

    for await (const event of readNdjson(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ t: 'speaker', slug: 'jasper' });
    expect(events[1]).toEqual({ t: 'delta', slug: 'jasper', text: 'Hello' });
    expect(events[2]).toEqual({ t: 'done', slug: 'jasper', usage: {} });
  });

  it('handles chunk boundaries (object split across chunks)', async () => {
    const json = '{"t":"delta","slug":"jasper","text":"Hello world"}\n';
    const bytes = new TextEncoder().encode(json);
    const chunks = [
      bytes.slice(0, 10),
      bytes.slice(10, 25),
      bytes.slice(25),
    ];

    const response = createMockResponse(chunks);
    const events: ChatEvent[] = [];

    for await (const event of readNdjson(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ t: 'delta', slug: 'jasper', text: 'Hello world' });
  });

  it('handles object split in 3 chunks', async () => {
    const json = '{"t":"tool","slug":"a","name":"n","label":"l","status":"ok"}\n';
    const bytes = new TextEncoder().encode(json);
    const chunks = [
      bytes.slice(0, 8),
      bytes.slice(8, 20),
      bytes.slice(20),
    ];

    const response = createMockResponse(chunks);
    const events: ChatEvent[] = [];

    for await (const event of readNdjson(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].t).toBe('tool');
  });

  it('skips empty lines', async () => {
    const chunks = [
      new TextEncoder().encode('{"t":"speaker","slug":"a"}\n\n\n{"t":"delta","slug":"a","text":"x"}\n'),
    ];

    const response = createMockResponse(chunks);
    const events: ChatEvent[] = [];

    for await (const event of readNdjson(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
  });

  it('ignores unknown event types', async () => {
    const chunks = [
      new TextEncoder().encode('{"t":"speaker","slug":"a"}\n{"t":"unknown","foo":"bar"}\n{"t":"delta","slug":"a","text":"x"}\n'),
    ];

    const response = createMockResponse(chunks);
    const events: ChatEvent[] = [];

    for await (const event of readNdjson(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(3);
    expect(events[1].t).toBe('unknown');
  });

  it('skips lines that fail JSON.parse', async () => {
    const chunks = [
      new TextEncoder().encode('{"t":"speaker","slug":"a"}\nnot json\n{"t":"delta","slug":"a","text":"x"}\n'),
    ];

    const response = createMockResponse(chunks);
    const events: ChatEvent[] = [];

    for await (const event of readNdjson(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
  });

  it('handles trailing partial line', async () => {
    const chunks = [
      new TextEncoder().encode('{"t":"speaker","slug":"a"}\n{"t":"delta","slug":"a","text":"'),
      new TextEncoder().encode('partial'),
    ];

    const response = createMockResponse(chunks);
    const events: ChatEvent[] = [];

    for await (const event of readNdjson(response)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].t).toBe('speaker');
  });
});

describe('ChatEvent types', () => {
  it('matches speaker event', () => {
    const event: ChatEvent = { t: 'speaker', slug: 'jasper' };
    expect(event.t).toBe('speaker');
  });

  it('matches delta event', () => {
    const event: ChatEvent = { t: 'delta', slug: 'jasper', text: 'Hello' };
    expect(event.text).toBe('Hello');
  });

  it('matches tool event with untrusted', () => {
    const event: ChatEvent = {
      t: 'tool',
      slug: 'jasper',
      name: 'query',
      label: 'db.query',
      status: 'ok',
      untrusted: true,
    };
    expect(event.untrusted).toBe(true);
  });

  it('matches ui event with suggestions', () => {
    const event: ChatEvent = {
      t: 'ui',
      slug: 'jasper',
      kind: 'suggestions',
      connector: 'jira',
      items: [{ name: 'Create', why: 'reason', status: 'pending' }],
    };
    expect(event.kind).toBe('suggestions');
  });

  it('matches phase event', () => {
    const event: ChatEvent = { t: 'phase', text: 'Meeting started' };
    expect(event.text).toBe('Meeting started');
  });

  it('matches route event', () => {
    const event: ChatEvent = { t: 'route', slugs: ['a', 'b'], source: 'router', confidence: 0.9 };
    expect(event.slugs).toEqual(['a', 'b']);
  });

  it('matches done event', () => {
    const event: ChatEvent = { t: 'done', slug: 'jasper', usage: { tokens: 10 } };
    expect(event.usage).toEqual({ tokens: 10 });
  });

  it('matches error event', () => {
    const event: ChatEvent = { t: 'error', slug: 'jasper', message: 'Failed' };
    expect(event.message).toBe('Failed');
  });

  it('matches fallback unknown event', () => {
    const event: ChatEvent = { t: 'custom', data: 123 };
    expect(event.t).toBe('custom');
  });
});