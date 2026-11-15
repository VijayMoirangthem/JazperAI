import { detailOf, sinceText, sortProblems, summarize, toneOf } from './health';
import type { HealthCheck } from '@/api/types';

const check = (over: Partial<HealthCheck>): HealthCheck => ({ name: 'x', label: 'Thing', ok: true, detail: '', fails: 0, since: 0, announced: false, ...over });

describe('system health helpers', () => {
  it('summarises: all good, one problem, several, still checking, nothing yet', () => {
    expect(summarize([check({}), check({ name: 'y' })])).toEqual({ tone: 'ok', text: 'Everything is working' });
    expect(summarize([check({}), check({ label: 'Database', ok: false })])).toEqual({ tone: 'bad', text: 'Database needs attention' });
    expect(summarize([check({ ok: false }), check({ ok: false })]).text).toBe('2 things need attention');
    expect(summarize([check({}), check({ ok: null })]).tone).toBe('unknown');
    expect(summarize([]).tone).toBe('unknown');
  });

  it('maps tones and details (a healthy check can carry a neutral note)', () => {
    expect(toneOf(check({ ok: false }))).toBe('bad');
    expect(toneOf(check({ ok: null }))).toBe('unknown');
    expect(detailOf(check({ ok: true, detail: 'not connected' }))).toBe('not connected');
    expect(detailOf(check({ ok: false, detail: '' }))).toBe('Not responding');
  });

  it('shows how long a problem has lasted', () => {
    expect(sinceText(1000, 1030)).toBe('just now');
    expect(sinceText(1000, 1000 + 5 * 60)).toBe('5 min');
    expect(sinceText(1000, 1000 + 3 * 3600)).toBe('3 h');
    expect(sinceText(1000, 1000 + 2 * 86400)).toBe('2 d');
    expect(sinceText(2000, 1000)).toBe('just now');
  });

  it('sorts newest first, errors before warnings at the same time', () => {
    const out = sortProblems([
      { time: '2026-11-15 10:00:00', level: 'warning', message: 'a', count: 1 },
      { time: '2026-11-15 11:00:00', level: 'warning', message: 'b', count: 1 },
      { time: '2026-11-15 11:00:00', level: 'error', message: 'c', count: 1 },
    ]);
    expect(out.map((p) => p.message)).toEqual(['c', 'b', 'a']);
  });
});
