const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function clockTime(ts: number): string {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${suffix}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY = 24 * 60 * 60 * 1000;

/** Time shown on the right of a conversation row. */
export function listTime(ts: number, now: number = Date.now()): string {
  if (!ts) return '';
  const today = startOfDay(now);
  const day = startOfDay(ts);
  if (day === today) return clockTime(ts);
  if (day === today - DAY) return 'Yesterday';
  if (day > today - 6 * DAY) return WEEKDAYS[new Date(ts).getDay()];
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === new Date(now).getFullYear() ? '' : ` ${d.getFullYear()}`}`;
}

/** Centred label between messages: "Today 7:58 AM", "Yesterday 4:20 PM", "Mon 9:02 AM", "12 Mar 2026 9:02 AM". */
export function separatorLabel(ts: number, now: number = Date.now()): string {
  const today = startOfDay(now);
  const day = startOfDay(ts);
  const time = clockTime(ts);
  if (day === today) return `Today ${time}`;
  if (day === today - DAY) return `Yesterday ${time}`;
  const d = new Date(ts);
  if (day > today - 6 * DAY) return `${WEEKDAYS[d.getDay()]} ${time}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${time}`;
}

export const SEPARATOR_GAP_MS = 30 * 60 * 1000;

export function needsSeparator(previousTs: number | null, ts: number): boolean {
  if (previousTs === null) return true;
  if (ts - previousTs > SEPARATOR_GAP_MS) return true;
  return startOfDay(ts) !== startOfDay(previousTs);
}

/** Plain one-line text for previews: markdown, code fences and newlines removed. */
export function plainPreview(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~)/g, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function conversationPreview(lastRole: string, lastText: string): string {
  const plain = plainPreview(lastText);
  if (!plain) return '';
  return lastRole === 'user' ? `You: ${plain}` : plain;
}

export function domainOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1].replace(/^www\./, '') : url;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'J';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
