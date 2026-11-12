import type { JasperEvent } from '@/api/types';
import { isNotificationEnabled, type NotificationToggles } from './routing';

export type AndroidChannel = 'approvals' | 'mail' | 'runs' | 'messages' | 'general';

export function channelForEvent(ev: Pick<JasperEvent, 'kind' | 'type'>): AndroidChannel {
  if (ev.kind === 'approval' || ev.type === 'approval') return 'approvals';
  if (ev.type === 'mail') return 'mail';
  if (ev.type === 'run' || ev.type === 'job') return 'runs';
  if (ev.type === 'message') return 'messages';
  return 'general';
}

/** What to show for one event, or null when the user switched that kind of alert off. */
export function notificationForEvent(
  ev: JasperEvent,
  toggles: NotificationToggles
): { title: string; body: string; channelId: AndroidChannel; data: { type: string; id: string } } | null {
  if (!isNotificationEnabled(ev.kind === 'approval' ? 'approval' : ev.type, toggles)) return null;
  const title = (ev.title || 'Jasper').slice(0, 120);
  const body = (ev.body || '').slice(0, 300);
  return { title, body, channelId: channelForEvent(ev), data: { type: ev.kind === 'approval' ? 'approval' : ev.type, id: ev.id } };
}

/** Wait time after a failed poll: 2 s, doubling, never more than 60 s. */
export function nextBackoff(previousMs: number): number {
  return Math.min(Math.max(previousMs * 2, 2000), 60000);
}

/** Remembers recent event ids so the same event never notifies twice (a restart replays from the saved cursor). */
export class SeenIds {
  private ids: string[] = [];
  constructor(private readonly max = 200) {}
  /** true the first time an id is seen */
  add(id: string): boolean {
    if (this.ids.includes(id)) return false;
    this.ids.push(id);
    if (this.ids.length > this.max) this.ids.shift();
    return true;
  }
}
