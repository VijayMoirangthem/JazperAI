import { AuthRevokedError, JasperClient } from '@/api/client';

const creds = { deviceId: 'dev-1', deviceSecret: 'secret' };

function res(status: number, body: unknown = {}, bytes?: number[]): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    arrayBuffer: async () => new Uint8Array(bytes ?? []).buffer,
  } as unknown as Response;
}

describe('voice calls on the phone client', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('returns the speech audio as bytes without using Blob.arrayBuffer (React Native has none)', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(res(200, {}, [1, 2, 3])) as unknown as typeof fetch;
    const client = new JasperClient('https://pc.example.ts.net', 'tok');
    const bytes = await client.speakVoiceBytes('hello', 'en-GB-RyanNeural', creds);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    const [url, init] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/remote/v1/voice/speak?text=hello&voice=en-GB-RyanNeural');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('renews an expired access token once and retries (this used to fail after 15 minutes)', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(401))                                   // expired token
      .mockResolvedValueOnce(res(200, { access_token: 'new-token' }))    // /auth/refresh
      .mockResolvedValueOnce(res(200, {}, [9, 9])) as unknown as typeof fetch;
    const client = new JasperClient('https://pc.example.ts.net', 'old');
    const bytes = await client.speakVoiceBytes('hi', 'en-GB-RyanNeural', creds);
    expect(Array.from(bytes)).toEqual([9, 9]);
    const calls = (globalThis.fetch as jest.Mock).mock.calls;
    expect(calls[1][0]).toContain('/remote/v1/auth/refresh');
    expect(calls[2][1].headers.Authorization).toBe('Bearer new-token');
  });

  it('reports a removed device instead of retrying forever', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue(res(401)) as unknown as typeof fetch;   // the token AND the refresh are refused
    const client = new JasperClient('https://pc.example.ts.net', 'old');
    await expect(client.speakVoiceBytes('hi', 'v', creds)).rejects.toBeInstanceOf(AuthRevokedError);
  });

  it('voice notes also renew the token', async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(res(401))
      .mockResolvedValueOnce(res(200, { access_token: 't2' }))
      .mockResolvedValueOnce(res(200, { text: 'mera email dikhao', empty: false })) as unknown as typeof fetch;
    const client = new JasperClient('https://pc.example.ts.net', 'old');
    const out = await client.transcribeVoice(new Blob(['x']), creds);
    expect(out.text).toBe('mera email dikhao');
  });
});
