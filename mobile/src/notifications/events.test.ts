import { SeenIds, channelForEvent, nextBackoff, notificationForEvent } from './events';
import type { JasperEvent } from '@/api/types';

const toggles = { approvals: true, mail: true, feature: true, alert: true };
const ev = (over: Partial<JasperEvent>): JasperEvent => ({
  id: '1', kind: 'notification', type: 'info', title: 'T', body: 'B', created_at: '2026-11-13T00:00:00Z', ...over,
});

describe('event notifications', () => {
  it('routes events to the right Android channel', () => {
    expect(channelForEvent({ kind: 'approval', type: 'approval' })).toBe('approvals');
    expect(channelForEvent({ kind: 'notification', type: 'mail' })).toBe('mail');
    expect(channelForEvent({ kind: 'notification', type: 'run' })).toBe('runs');
    expect(channelForEvent({ kind: 'notification', type: 'whatever' })).toBe('general');
  });

  it('builds a notification with routing data', () => {
    const n = notificationForEvent(ev({ kind: 'approval', type: 'approval', title: 'Approval needed (Tier 3)', id: 'x' }), toggles);
    expect(n).toEqual({ title: 'Approval needed (Tier 3)', body: 'B', channelId: 'approvals', categoryId: 'approval-t3', data: { type: 'approval', id: 'x' } });
  });

  it('respects the per-kind switches', () => {
    expect(notificationForEvent(ev({ type: 'mail' }), { ...toggles, mail: false })).toBeNull();
    expect(notificationForEvent(ev({ kind: 'approval', type: 'approval' }), { ...toggles, approvals: false })).toBeNull();
    expect(notificationForEvent(ev({ type: 'info' }), { ...toggles, mail: false })).not.toBeNull();
  });

  it('backs off 2s, 4s ... up to 60s', () => {
    expect(nextBackoff(0)).toBe(2000);
    expect(nextBackoff(2000)).toBe(4000);
    expect(nextBackoff(40000)).toBe(60000);
  });

  it('never notifies twice for the same event', () => {
    const s = new SeenIds(2);
    expect(s.add('a')).toBe(true);
    expect(s.add('a')).toBe(false);
    s.add('b'); s.add('c');
    expect(s.add('a')).toBe(true); // forgotten after the window
  });
});

describe('approval notifications carry the right buttons', () => {
  const approval = (tier?: number) => ev({ kind: 'approval', type: 'approval', id: 'req-1', title: 'Approval needed', ...(tier !== undefined ? { tier } : {}) });

  it('Tier 2 offers approve/reject, Tier 3 (or unknown) only reject/review', () => {
    expect(notificationForEvent(approval(2), toggles)?.categoryId).toBe('approval-t2');
    expect(notificationForEvent(approval(3), toggles)?.categoryId).toBe('approval-t3');
    expect(notificationForEvent(approval(), toggles)?.categoryId).toBe('approval-t3');   // unknown tier: the safe side
  });

  it('passes the id and tier along so a tap can answer the right request', () => {
    expect(notificationForEvent(approval(2), toggles)?.data).toEqual({ type: 'approval', id: 'req-1', tier: 2 });
  });

  it('ordinary notifications have no buttons', () => {
    expect(notificationForEvent(ev({ type: 'mail' }), toggles)?.categoryId).toBeUndefined();
  });
});
