import { pollOnce, type PollDeps } from './poll';
import type { JasperEvent, StoredCredentials } from '@/api/types';

const creds: StoredCredentials = { baseUrl: 'https://pc.example.ts.net', deviceId: 'd', deviceSecret: 's' };
const toggles = { approvals: true, mail: true, feature: true, alert: true };
const ev = (over: Partial<JasperEvent>): JasperEvent => ({ id: '1', kind: 'notification', type: 'mail', title: 'New mail', body: 'from Kunal', created_at: '2026-11-15T10:00:00Z', ...over });

function deps(over: Partial<PollDeps> = {}) {
  const shown: unknown[] = [];
  const saved: string[] = [];
  const d: PollDeps = {
    loadCredentials: async () => creds,
    getEvents: async () => ({ events: [ev({})], cursor: 'c2' }),
    loadCursor: async () => 'c1',
    saveCursor: async (c) => void saved.push(c),
    loadToggles: async () => toggles,
    show: async (n) => void shown.push(n),
    ...over,
  };
  return { d, shown, saved };
}

describe('background poll', () => {
  it('shows new events and moves the cursor forward', async () => {
    const { d, shown, saved } = deps();
    expect(await pollOnce(d)).toEqual({ shown: 1 });
    expect(shown).toHaveLength(1);
    expect(saved).toEqual(['c2']);
  });

  it('does nothing when the phone is not paired', async () => {
    const { d, shown } = deps({ loadCredentials: async () => null });
    expect(await pollOnce(d)).toEqual({ shown: 0, reason: 'not paired' });
    expect(shown).toHaveLength(0);
  });

  it('the very first run only sets the cursor (old events are never replayed)', async () => {
    const { d, shown, saved } = deps({ loadCursor: async () => null });
    const r = await pollOnce(d);
    expect(r.shown).toBe(0);
    expect(shown).toHaveLength(0);
    expect(saved).toEqual(['c2']);
  });

  it('respects the per-kind switches', async () => {
    const { d, shown } = deps({ loadToggles: async () => ({ ...toggles, mail: false }) });
    expect(await pollOnce(d)).toEqual({ shown: 0 });
    expect(shown).toHaveLength(0);
  });

  it('lets a failure propagate so Android retries at the next window, and keeps the old cursor', async () => {
    const { d, saved } = deps({ getEvents: async () => { throw new Error('PC unreachable'); } });
    await expect(pollOnce(d)).rejects.toThrow('PC unreachable');
    expect(saved).toEqual([]);
  });
});
