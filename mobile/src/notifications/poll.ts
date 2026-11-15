import type { EventsResponse, StoredCredentials } from '@/api/types';
import { notificationForEvent } from './events';
import type { NotificationToggles } from './routing';

/**
 * One non-waiting check for new events. Used by the 15-minute background task, which Android keeps running (and restarts after a
 * phone reboot) even when the live listener service is not running. It must work without the app's screens or stores being loaded, so
 * everything it needs comes in through `deps`.
 */
export interface PollDeps {
  loadCredentials: () => Promise<StoredCredentials | null>;
  getEvents: (creds: StoredCredentials, since: string | null) => Promise<EventsResponse>;
  loadCursor: () => Promise<string | null>;
  saveCursor: (cursor: string) => Promise<void>;
  loadToggles: () => Promise<NotificationToggles>;
  show: (n: { title: string; body: string; channelId: string; categoryId?: string; data: { type: string; id: string; tier?: number } }) => Promise<void>;
}

export async function pollOnce(deps: PollDeps): Promise<{ shown: number; reason?: string }> {
  const creds = await deps.loadCredentials();
  if (!creds) return { shown: 0, reason: 'not paired' };
  const since = await deps.loadCursor();
  const res = await deps.getEvents(creds, since);
  await deps.saveCursor(res.cursor);
  if (since === null) return { shown: 0, reason: 'first run: cursor set' };   // never replay old events
  const toggles = await deps.loadToggles();
  let shown = 0;
  for (const ev of res.events) {
    const n = notificationForEvent(ev, toggles);
    if (!n) continue;
    await deps.show(n);
    shown += 1;
  }
  return { shown };
}
