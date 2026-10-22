import { CommsMessage } from '@/api/types';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { useThread } from './thread';

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, JasperClient: jest.fn() };
});
jest.mock('@/auth/useAuth', () => ({ useAuth: { getState: jest.fn() } }));

const getCommsThread = jest.fn();

const credentials = {
  baseUrl: 'https://example.test',
  deviceId: 'device-1',
  deviceSecret: 'secret-1',
};

function message(id: number, text = `message ${id}`): CommsMessage {
  return {
    id,
    ts: `2026-10-23T09:00:0${id}Z`,
    from_slug: 'jasper',
    to_slug: 'messenger',
    kind: 'message',
    text,
  };
}

describe('useThread', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth.getState as unknown as jest.Mock).mockReturnValue({
      credentials,
      accessToken: 'token',
    });
    (JasperClient as unknown as jest.Mock).mockImplementation(() => ({ getCommsThread }));
    useThread.setState({
      threadId: null,
      messages: [],
      sinceId: 0,
      loading: false,
      error: null,
    });
  });

  it('loads a thread from since_id 0 and advances since_id', async () => {
    getCommsThread.mockResolvedValueOnce({ messages: [message(3), message(5)] });

    useThread.getState().open('jasper:messenger');
    await useThread.getState().load('jasper:messenger');

    expect(getCommsThread).toHaveBeenCalledWith('jasper:messenger', 0, {
      deviceId: 'device-1',
      deviceSecret: 'secret-1',
    });
    expect(useThread.getState().messages.map((item) => item.id)).toEqual([3, 5]);
    expect(useThread.getState().sinceId).toBe(5);

    getCommsThread.mockResolvedValueOnce({ messages: [message(7)] });
    await useThread.getState().load('jasper:messenger');

    expect(getCommsThread).toHaveBeenLastCalledWith('jasper:messenger', 5, {
      deviceId: 'device-1',
      deviceSecret: 'secret-1',
    });
    expect(useThread.getState().messages.map((item) => item.id)).toEqual([3, 5, 7]);
    expect(useThread.getState().sinceId).toBe(7);
  });

  it('merges duplicate ids instead of appending them', async () => {
    getCommsThread.mockResolvedValueOnce({ messages: [message(3), message(5)] });
    useThread.getState().open('t');
    await useThread.getState().load('t');

    getCommsThread.mockResolvedValueOnce({ messages: [message(5, 'edited')] });
    await useThread.getState().load('t');

    expect(useThread.getState().messages).toHaveLength(2);
    expect(useThread.getState().messages[1].text).toBe('edited');
    expect(useThread.getState().sinceId).toBe(5);
  });

  it('keeps messages when a poll fails', async () => {
    getCommsThread.mockResolvedValueOnce({ messages: [message(1)] });
    useThread.getState().open('t');
    await useThread.getState().load('t');

    getCommsThread.mockRejectedValueOnce(new Error('Network down'));
    await useThread.getState().load('t');

    expect(useThread.getState().messages).toHaveLength(1);
    expect(useThread.getState().error).toBe('Network down');
  });

  it('resets messages when opening a different thread', () => {
    useThread.setState({
      threadId: 'old',
      messages: [message(9)],
      sinceId: 9,
      error: 'stale',
    });

    useThread.getState().open('new');

    expect(useThread.getState().threadId).toBe('new');
    expect(useThread.getState().messages).toEqual([]);
    expect(useThread.getState().sinceId).toBe(0);
    expect(useThread.getState().error).toBeNull();
  });

  it('ignores a response for a thread that is no longer open', async () => {
    let resolveThread: ((value: { messages: CommsMessage[] }) => void) | undefined;
    getCommsThread.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveThread = resolve;
      })
    );

    useThread.getState().open('old');
    const pending = useThread.getState().load('old');
    useThread.getState().open('new');
    resolveThread?.({ messages: [message(4)] });
    await pending;

    expect(useThread.getState().messages).toEqual([]);
  });
});
