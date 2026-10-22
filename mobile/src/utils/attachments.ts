import { Attachment } from '@/api/types';

export const MAX_ATTACHMENTS = 8;
export const MAX_TEXT_CHARS = 200_000;

export const TEXT_EXTENSIONS = ['.txt', '.md', '.json', '.py', '.ts', '.js', '.csv', '.yml', '.html'];

export function isTextLikeFile(name: string): boolean {
  const lower = name.toLowerCase();
  return TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

export function clampText(text: string, max = MAX_TEXT_CHARS): string {
  return text.length > max ? text.slice(0, max) : text;
}

export function mimeFallback(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.csv')) return 'text/csv';
  if (lower.endsWith('.html')) return 'text/html';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.yml')) return 'text/yaml';
  if (isTextLikeFile(name)) return 'text/plain';
  return 'application/octet-stream';
}

export function addAttachment(list: Attachment[], attachment: Attachment): Attachment[] {
  if (list.length >= MAX_ATTACHMENTS) return list;
  return [...list, attachment];
}

export function isReadableAttachment(attachment: Attachment): boolean {
  return typeof attachment.text === 'string' && attachment.text.length > 0;
}

export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mime.startsWith('image/') && typeof attachment.uri === 'string';
}

export function toApiAttachment(attachment: Attachment): Attachment {
  if (attachment.text === undefined) {
    return { name: attachment.name, mime: attachment.mime };
  }
  return { name: attachment.name, mime: attachment.mime, text: attachment.text };
}
