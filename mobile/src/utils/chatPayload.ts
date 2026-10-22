import { Attachment } from '@/api/types';
import { Message } from '@/db/chat';

export interface ToolPayload {
  name: string;
  label: string;
  status: 'running' | 'ok' | 'error';
  result?: unknown;
  untrusted?: boolean;
}

export interface UiPayload {
  kind: 'credentials' | 'oauth' | 'suggestions';
  connector: string;
  items: { name: string; why: string; status: string }[];
}

export function toolStatusToMessageStatus(status: ToolPayload['status']): Message['status'] {
  if (status === 'running') return 'streaming';
  if (status === 'error') return 'error';
  return 'done';
}

export function getToolPayload(message: Message): ToolPayload | null {
  if (!message.tool_json) return null;
  try {
    const parsed = JSON.parse(message.tool_json) as Partial<ToolPayload>;
    if (!parsed || typeof parsed.label !== 'string') return null;
    return {
      name: typeof parsed.name === 'string' ? parsed.name : '',
      label: parsed.label,
      status: parsed.status ?? 'running',
      result: parsed.result,
      untrusted: parsed.untrusted === true,
    };
  } catch {
    return null;
  }
}

export function getUiPayload(message: Message): UiPayload | null {
  if (!message.ui_json) return null;
  try {
    const parsed = JSON.parse(message.ui_json) as Partial<UiPayload>;
    if (!parsed || typeof parsed.kind !== 'string') return null;
    return {
      kind: parsed.kind,
      connector: typeof parsed.connector === 'string' ? parsed.connector : '',
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch {
    return null;
  }
}

export function parseAttachments(message: Message): Attachment[] {
  if (!message.attachments_json) return [];
  try {
    const parsed = JSON.parse(message.attachments_json) as Attachment[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
