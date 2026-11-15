import type { PairedDevice } from '@/api/types';

/** "Active now", "5 min ago", "3 h ago", "2 days ago" or "Never used". */
export function lastSeenText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'Never used';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Unknown';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 120) return 'Active now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'Yesterday' : `${d} days ago`;
}

/** This phone first, then the most recently active. */
export function sortDevices(devices: PairedDevice[]): PairedDevice[] {
  return [...devices].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return (Date.parse(b.last_seen ?? '') || 0) - (Date.parse(a.last_seen ?? '') || 0);
  });
}

/** Devices that look unused: not seen for 14 days (or never) and not this phone. A hint to remove them. */
export function isStale(d: PairedDevice, now: number = Date.now()): boolean {
  if (d.current) return false;
  const t = Date.parse(d.last_seen ?? '');
  return Number.isNaN(t) || now - t > 14 * 86400 * 1000;
}
