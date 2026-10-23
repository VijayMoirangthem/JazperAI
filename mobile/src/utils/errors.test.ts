import { AuthRevokedError, HttpError, RateLimitError } from '@/api/client';
import { bannerFor, classifyError, isNetworkError } from './errors';

describe('classifyError', () => {
  it('maps a revoked device to unpaired', () => {
    expect(classifyError(new AuthRevokedError())).toBe('unpaired');
    expect(classifyError(Object.assign(new Error('Unauthorized'), { name: 'AuthRevokedError' }))).toBe(
      'unpaired'
    );
  });

  it('maps rate limiting to rate-limited', () => {
    expect(classifyError(new RateLimitError())).toBe('rate-limited');
  });

  it('maps fetch failures to offline', () => {
    expect(classifyError(new TypeError('Network request failed'))).toBe('offline');
    expect(classifyError(new Error('Network request failed'))).toBe('offline');
    expect(classifyError(new Error('The request timed out'))).toBe('offline');
    expect(classifyError(new Error('Connection lost'))).toBe('offline');
  });

  it('leaves server and unknown errors alone', () => {
    expect(classifyError(new HttpError(500, 'HTTP 500'))).toBe('unknown');
    expect(classifyError(new Error('Something odd'))).toBe('unknown');
    expect(classifyError(null)).toBe('unknown');
  });
});

describe('isNetworkError', () => {
  it('does not treat auth or rate limit errors as network errors', () => {
    expect(isNetworkError(new AuthRevokedError())).toBe(false);
    expect(isNetworkError(new RateLimitError())).toBe(false);
  });

  it('does not treat an abort as a network error', () => {
    expect(isNetworkError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(false);
  });
});

describe('bannerFor', () => {
  it('gives copy for every recoverable error', () => {
    expect(bannerFor('offline')?.title).toBe('Cannot reach your computer');
    expect(bannerFor('unpaired')?.title).toBe('Phone unpaired');
    expect(bannerFor('rate-limited')?.title).toBe('Slow down');
  });

  it('shows nothing for unknown errors', () => {
    expect(bannerFor('unknown')).toBeNull();
  });
});
