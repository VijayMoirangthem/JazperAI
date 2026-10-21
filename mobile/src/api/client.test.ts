import { JasperClient, AuthRevokedError, RateLimitError, HttpError } from './client';

const mockFetch = jest.fn();
const g = { fetch: mockFetch, __DEV__: true } as { fetch: typeof fetch; __DEV__: boolean };
globalThis.fetch = mockFetch;

const deviceCredentials = { deviceId: 'test-device', deviceSecret: 'test-secret' };
const baseUrl = 'https://api.example.com';

function createClient(extraHeaders?: Record<string, string>) {
  return new JasperClient(baseUrl, 'test-token', extraHeaders);
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('JasperClient', () => {
  describe('constructor', () => {
    it('accepts valid https URL', () => {
      expect(() => new JasperClient('https://api.example.com')).not.toThrow();
    });

    it('accepts http://10.0.2.2 in dev', () => {
      expect(() => new JasperClient('http://10.0.2.2:8000')).not.toThrow();
    });

    it('accepts http://localhost in dev', () => {
      expect(() => new JasperClient('http://localhost:8000')).not.toThrow();
    });

    it('rejects plain http in production', () => {
      const originalDev = g.__DEV__;
      g.__DEV__ = false;
      expect(() => new JasperClient('http://api.example.com')).toThrow();
      g.__DEV__ = originalDev;
    });
  });

  describe('request', () => {
    it('adds Authorization header', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'ok' }),
      });

      const client = createClient();
      await client.me(deviceCredentials);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/remote/v1/me`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      );
    });

    it('retries once on 401 with refresh', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ detail: 'expired' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'new-token', expires_in: 900 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ device_id: 'test-device', name: 'Test' }),
        });

      const client = createClient();
      const result = await client.me(deviceCredentials);

      expect(result).toEqual({ device_id: 'test-device', name: 'Test' });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(client['accessToken']).toBe('new-token');
    });

    it('throws AuthRevokedError when refresh fails', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ detail: 'expired' }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 401,
          json: async () => ({ detail: 'invalid' }),
        });

      const client = createClient();
      await expect(client.me(deviceCredentials)).rejects.toThrow(AuthRevokedError);
    });

    it('retries once on 429 after 2s delay', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ device_id: 'test-device', name: 'Test' }),
        });

      const client = createClient();
      const start = Date.now();
      const result = await client.me(deviceCredentials);
      const elapsed = Date.now() - start;

      expect(result).toEqual({ device_id: 'test-device', name: 'Test' });
      expect(elapsed).toBeGreaterThanOrEqual(1900);
    });

    it('throws RateLimitError on 429 after retry fails', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429 })
        .mockResolvedValueOnce({ ok: false, status: 429 });

      const client = createClient();
      await expect(client.me(deviceCredentials)).rejects.toThrow(RateLimitError);
    });

    it('throws HttpError on other error statuses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ detail: 'Internal error' }),
      });

      const client = createClient();
      await expect(client.me(deviceCredentials)).rejects.toThrow(HttpError);
    });
  });

  describe('pair', () => {
    it('calls pair endpoint without auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          device_id: 'new-device',
          device_secret: 'secret',
          access_token: 'token',
          expires_in: 900,
        }),
      });

      const client = new JasperClient(baseUrl);
      const result = await client.pair({
        code: 'ABC12345',
        name: 'Test Device',
        platform: 'android',
      });

      expect(result.device_id).toBe('new-device');
      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/remote/v1/pair/complete`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });
  });

  describe('refresh', () => {
    it('calls refresh endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'new-token', expires_in: 900 }),
      });

      const client = new JasperClient(baseUrl);
      const result = await client.refresh('device-id', 'secret');

      expect(result.access_token).toBe('new-token');
    });
  });

  describe('concurrent 401 handling', () => {
    it('deduplicates concurrent refreshes', async () => {
      // Simulate: 3 requests hit 401 -> 1 refresh -> 3 retries succeed
      let callCount = 0;
      mockFetch.mockImplementation(async () => {
        callCount++;
        if (callCount <= 3) {
          // First 3 calls: initial requests get 401
          return {
            ok: false,
            status: 401,
            json: async () => ({ detail: 'expired' }),
          };
        }
        if (callCount === 4) {
          // 4th call: refresh token
          return {
            ok: true,
            json: async () => ({ access_token: 'new-token', expires_in: 900 }),
          };
        }
        // Remaining calls: retries succeed
        return {
          ok: true,
          json: async () => ({ device_id: 'test-device', name: 'Test' }),
        };
      });

      const client = createClient();
      const [r1, r2, r3] = await Promise.all([
        client.me(deviceCredentials),
        client.me(deviceCredentials),
        client.me(deviceCredentials),
      ]);

      expect(r1).toEqual({ device_id: 'test-device', name: 'Test' });
      expect(r2).toEqual({ device_id: 'test-device', name: 'Test' });
      expect(r3).toEqual({ device_id: 'test-device', name: 'Test' });
      // Should have made: 3 initial (401) + 1 refresh + 3 retries = 7 calls
      // But since refreshPromise is shared, only 1 refresh happens
      expect(callCount).toBeLessThanOrEqual(7);
    });
  });

  describe('extra headers', () => {
    it('includes extra headers in requests', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ device_id: 'test-device', name: 'Test' }),
      });

      const client = new JasperClient(baseUrl, 'token', {
        'CF-Access-Client-Id': 'client-id',
        'CF-Access-Client-Secret': 'client-secret',
      });
      await client.me(deviceCredentials);

      expect(mockFetch).toHaveBeenCalledWith(
        `${baseUrl}/remote/v1/me`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'CF-Access-Client-Id': 'client-id',
            'CF-Access-Client-Secret': 'client-secret',
          }),
        })
      );
    });

    it('allows updating extra headers', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const client = new JasperClient(baseUrl, 'token');
      client.setExtraHeaders({ 'X-Custom': 'value1' });
      await client.getBots(deviceCredentials);
      client.setExtraHeaders({ 'X-Custom': 'value2' });
      await client.getBots(deviceCredentials);

      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ 'X-Custom': 'value1' }) })
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.any(String),
        expect.objectContaining({ headers: expect.objectContaining({ 'X-Custom': 'value2' }) })
      );
    });
  });
});