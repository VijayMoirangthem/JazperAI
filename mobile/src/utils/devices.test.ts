import { isStale, lastSeenText, sortDevices } from './devices';
import type { PairedDevice } from '@/api/types';

const NOW = Date.parse('2026-11-15T12:00:00Z');
const dev = (over: Partial<PairedDevice>): PairedDevice => ({ id: 'a', name: 'Phone', platform: 'android', created_at: '2026-11-01T00:00:00Z', last_seen: null, current: false, ...over });

describe('paired devices helpers', () => {
  it('describes when a device was last used', () => {
    expect(lastSeenText(null, NOW)).toBe('Never used');
    expect(lastSeenText('not a date', NOW)).toBe('Unknown');
    expect(lastSeenText('2026-11-15T11:59:30Z', NOW)).toBe('Active now');
    expect(lastSeenText('2026-11-15T11:30:00Z', NOW)).toBe('30 min ago');
    expect(lastSeenText('2026-11-15T09:00:00Z', NOW)).toBe('3 h ago');
    expect(lastSeenText('2026-11-14T08:00:00Z', NOW)).toBe('Yesterday');
    expect(lastSeenText('2026-11-10T12:00:00Z', NOW)).toBe('5 days ago');
  });

  it('puts this phone first, then the most recently active', () => {
    const out = sortDevices([
      dev({ id: 'old', last_seen: '2026-11-01T00:00:00Z' }),
      dev({ id: 'me', current: true, last_seen: '2026-10-01T00:00:00Z' }),
      dev({ id: 'new', last_seen: '2026-11-14T00:00:00Z' }),
      dev({ id: 'never', last_seen: null }),
    ]);
    expect(out.map((d) => d.id)).toEqual(['me', 'new', 'old', 'never']);
  });

  it('flags devices unused for two weeks, never this phone', () => {
    expect(isStale(dev({ last_seen: '2026-10-20T00:00:00Z' }), NOW)).toBe(true);
    expect(isStale(dev({ last_seen: null }), NOW)).toBe(true);
    expect(isStale(dev({ last_seen: '2026-11-10T00:00:00Z' }), NOW)).toBe(false);
    expect(isStale(dev({ current: true, last_seen: null }), NOW)).toBe(false);
  });
});
