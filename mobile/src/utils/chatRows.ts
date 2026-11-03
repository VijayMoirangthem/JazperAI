import { Message } from '@/db/chat';
import { needsSeparator, separatorLabel } from '@/utils/format';

export type ChatRow =
  | { type: 'sep'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'msg'; key: string; message: Message; first: boolean; last: boolean }
  | { type: 'tools'; key: string; messages: Message[] }
  | { type: 'ui'; key: string; message: Message }
  | { type: 'system'; key: string; message: Message }
  | { type: 'thinking'; key: string };

const BUBBLE_ROLES = new Set(['user', 'assistant']);

function senderKey(message: Message): string {
  return message.role === 'user' ? 'me' : `bot:${message.from_slug}`;
}

/**
 * Turns the stored messages (oldest first) into display rows (oldest first):
 * time separators, grouped bubbles, one summary row per run of tool chips,
 * an "Unread" divider and a thinking row while a reply has not started.
 */
export function buildRows(
  messages: Message[],
  options: { now?: number; unreadFromId?: number | null; streaming?: boolean } = {}
): ChatRow[] {
  const { now = Date.now(), unreadFromId = null, streaming = false } = options;
  const rows: ChatRow[] = [];
  let previousTs: number | null = null;
  let toolRun: Message[] = [];
  let unreadShown = false;

  const flushTools = () => {
    if (toolRun.length > 0) {
      rows.push({ type: 'tools', key: `tools-${toolRun[0].id}`, messages: toolRun });
      toolRun = [];
    }
  };

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];

    if (message.role === 'tool') {
      toolRun.push(message);
      continue;
    }
    flushTools();

    if (needsSeparator(previousTs, message.ts)) {
      rows.push({ type: 'sep', key: `sep-${message.id}`, label: separatorLabel(message.ts, now) });
    }
    previousTs = message.ts;

    if (!unreadShown && unreadFromId !== null && message.id === unreadFromId) {
      rows.push({ type: 'unread', key: 'unread' });
      unreadShown = true;
    }

    if (message.role === 'ui') {
      rows.push({ type: 'ui', key: `ui-${message.id}`, message });
    } else if (message.role === 'system') {
      rows.push({ type: 'system', key: `sys-${message.id}`, message });
    } else if (BUBBLE_ROLES.has(message.role)) {
      const prev = messages[index - 1];
      const next = messages[index + 1];
      const sameAsPrev =
        !!prev && BUBBLE_ROLES.has(prev.role) && senderKey(prev) === senderKey(message) && !needsSeparator(prev.ts, message.ts);
      const sameAsNext =
        !!next && BUBBLE_ROLES.has(next.role) && senderKey(next) === senderKey(message) && !needsSeparator(message.ts, next.ts);
      rows.push({ type: 'msg', key: `m-${message.id}`, message, first: !sameAsPrev, last: !sameAsNext });
    }
  }
  flushTools();

  if (streaming) {
    const lastBubble = [...messages].reverse().find((m) => BUBBLE_ROLES.has(m.role));
    const replying = lastBubble?.role === 'assistant' && lastBubble.status === 'streaming' && lastBubble.text.trim().length > 0;
    if (!replying) rows.push({ type: 'thinking', key: 'thinking' });
  }
  return rows;
}

/** "Working… 3 steps" while running, "Used 3 tools" when finished. */
export function toolSummary(running: number, total: number): string {
  if (running > 0) return `Working… ${total} ${total === 1 ? 'step' : 'steps'}`;
  return `Used ${total} ${total === 1 ? 'tool' : 'tools'}`;
}

const URL_RE = /https?:\/\/[^\s<>()\[\]"']+[^\s<>()\[\]"'.,;:!?]/gi;

export function extractLinks(text: string, max = 2): string[] {
  const found = text.match(URL_RE) ?? [];
  const unique: string[] = [];
  for (const url of found) if (!unique.includes(url)) unique.push(url);
  return unique.slice(0, max);
}

export type LinkKind = 'doc' | 'sheet' | 'slide' | 'pdf' | 'image' | 'link';

export function linkKind(url: string): LinkKind {
  const lower = url.toLowerCase();
  if (/docs\.google\.com\/document|\.docx?(\?|$)/.test(lower)) return 'doc';
  if (/docs\.google\.com\/spreadsheets|\.xlsx?(\?|$)|\.csv(\?|$)/.test(lower)) return 'sheet';
  if (/docs\.google\.com\/presentation|\.pptx?(\?|$)/.test(lower)) return 'slide';
  if (/\.pdf(\?|$)/.test(lower)) return 'pdf';
  if (/\.(png|jpe?g|gif|webp)(\?|$)/.test(lower)) return 'image';
  return 'link';
}

export function linkTitle(url: string): string {
  try {
    const clean = url.replace(/^https?:\/\//i, '').split(/[?#]/)[0].replace(/\/+$/, '');
    const parts = clean.split('/');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && last && !/^(edit|view|preview|pub)$/i.test(last)) return decodeURIComponent(last).slice(0, 60);
    return parts[0].replace(/^www\./, '');
  } catch {
    return url.slice(0, 60);
  }
}
