import type { JasperEvent } from '@/api/types';
import { isNotificationEnabled, type NotificationToggles } from './routing';

export type AndroidChannel = 'approvals' | 'mail' | 'runs' | 'messages' | 'general';
export type ApprovalCategory = 'approval-t2' | 'approval-t3';

/** Tier 2 can be approved with one tap; Tier 3 needs your fingerprint inside the app, so it only offers Reject and Review. */
export function categoryForApproval(tier: number | undefined): ApprovalCategory {
  return (tier ?? 3) >= 3 ? 'approval-t3' : 'approval-t2';
}

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
): { title: string; body: string; channelId: AndroidChannel; categoryId?: ApprovalCategory; data: { type: string; id: string; tier?: number } } | null {
  if (!isNotificationEnabled(ev.kind === 'approval' ? 'approval' : ev.type, toggles)) return null;
  const title = (ev.title || 'Jasper').slice(0, 120);
  const body = (ev.body || '').slice(0, 300);
  const approval = ev.kind === 'approval';
  return {
    title,
    body,
    channelId: channelForEvent(ev),
    ...(approval ? { categoryId: categoryForApproval(ev.tier) } : {}),
    data: { type: approval ? 'approval' : ev.type, id: ev.id, ...(approval && ev.tier !== undefined ? { tier: ev.tier } : {}) },
  };
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
