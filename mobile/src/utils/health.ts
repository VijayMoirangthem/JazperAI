import type { HealthCheck, HealthProblem } from '@/api/types';

export type HealthTone = 'ok' | 'bad' | 'unknown';

export function toneOf(check: HealthCheck): HealthTone {
  if (check.ok === true) return 'ok';
  if (check.ok === false) return 'bad';
  return 'unknown';
}

/** One line for the top of the screen: what is wrong, or that everything is fine. */
export function summarize(checks: HealthCheck[]): { tone: HealthTone; text: string } {
  if (checks.length === 0) return { tone: 'unknown', text: 'No checks have run yet. They start about a minute after the PC starts Jasper.' };
  const bad = checks.filter((c) => c.ok === false);
  if (bad.length > 0) {
    return { tone: 'bad', text: bad.length === 1 ? `${bad[0].label} needs attention` : `${bad.length} things need attention` };
  }
  if (checks.some((c) => c.ok === null)) return { tone: 'unknown', text: 'Checking...' };
  return { tone: 'ok', text: 'Everything is working' };
}

/** "Not connected" is a neutral note from a healthy check, not a problem. */
export function detailOf(check: HealthCheck): string {
  if (check.ok === false) return check.detail || 'Not responding';
  return check.detail || '';
}

export function sinceText(since: number, now: number = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - since));
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

/** Newest problems first, errors before warnings only when the time is equal (the server already sorts by time). */
export function sortProblems(problems: HealthProblem[]): HealthProblem[] {
  return [...problems].sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : a.level === b.level ? 0 : a.level === 'error' ? -1 : 1));
}
