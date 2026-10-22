import { CommsMessage, SLO } from '@/api/types';

export const ACTIVITY_POLL_MS = 15_000;
export const THREAD_POLL_MS = 3_000;

export function threadTitle(from: string, to: string): string {
  return `${from} \u2192 ${to}`;
}

export function statusLabel(status: SLO['status']): string {
  if (status === 'ok') return 'OK';
  if (status === 'breached') return 'Breached';
  return 'No data';
}

export function formatBudget(value: number | null): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'No data';
  return `${Math.round(value * 100)}% remaining`;
}

export function isMonospaceKind(kind: CommsMessage['kind']): boolean {
  return kind === 'tool' || kind === 'result';
}
