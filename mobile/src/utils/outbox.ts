import { Attachment, ChatHistoryItem } from '@/api/types';

export interface OutboxPayload {
  messageId: number;
  text: string;
  history: ChatHistoryItem[];
  attachments: Attachment[];
}

export interface DrainableOutboxItem {
  id: number;
}

export interface DrainResult {
  sent: number;
  failed: boolean;
}

const sentOutboxIds = new Set<number>();

/**
 * Sends queued items one at a time, oldest first. Once an item has been sent
 * its outbox id is remembered so a stale list can never send it twice.
 */
export async function drainOutbox<T extends DrainableOutboxItem>(
  items: T[],
  send: (item: T) => Promise<void>,
  remove: (id: number) => void
): Promise<DrainResult> {
  let sent = 0;

  for (const item of items) {
    if (sentOutboxIds.has(item.id)) continue;

    try {
      await send(item);
    } catch {
      return { sent, failed: true };
    }

    sentOutboxIds.add(item.id);
    remove(item.id);
    sent += 1;
  }

  return { sent, failed: false };
}

export function hasSentOutboxItem(id: number): boolean {
  return sentOutboxIds.has(id);
}

export function resetOutboxGuard(): void {
  sentOutboxIds.clear();
}
