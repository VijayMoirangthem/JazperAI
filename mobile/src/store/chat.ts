import { create } from 'zustand';
import { Attachment, ChatEvent, ChatHistoryItem, StoredCredentials } from '@/api/types';
import { JasperClient } from '@/api/client';
import { streamChat } from '@/api/ndjson';
import { useAuth } from '@/auth/useAuth';
import {
  Message,
  deleteMessage as deleteMessageRow,
  deleteMessagesFromId,
  initChatDb,
  insertMessage,
  listMessages,
  updateMessage,
} from '@/db/chat';

import {
  ToolPayload,
  UiPayload,
  getToolPayload,
  getUiPayload,
  parseAttachments,
  toolStatusToMessageStatus,
} from '@/utils/chatPayload';

export { getToolPayload, getUiPayload, parseAttachments };
export type { ToolPayload, UiPayload };

type SpeakerEvent = Extract<ChatEvent, { t: 'speaker' }>;
type DeltaEvent = Extract<ChatEvent, { t: 'delta' }>;
type ToolEvent = Extract<ChatEvent, { t: 'tool' }>;
type UiEvent = Extract<ChatEvent, { t: 'ui' }>;
type PhaseEvent = Extract<ChatEvent, { t: 'phase' }>;
type DoneEvent = Extract<ChatEvent, { t: 'done' }>;
type ErrorEvent = Extract<ChatEvent, { t: 'error' }>;

function isEventOfType<E extends ChatEvent>(event: ChatEvent, type: E['t']): event is E {
  return event.t === type;
}

function createBotMessage(slug: string, text: string): Message {
  return {
    id: 0,
    bot_slug: slug,
    role: 'assistant',
    from_slug: slug,
    text,
    ts: Date.now(),
    status: 'streaming',
  };
}

/**
 * Finds the bot bubble that incoming deltas belong to. A bubble stops being
 * current once a tool chip, a card or a divider was rendered after it.
 */
function findActiveBotIndex(messages: Message[], slug: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant' || message.from_slug !== slug || message.status !== 'streaming') {
      continue;
    }
    const blocked = messages
      .slice(index + 1)
      .some((later) => later.role === 'tool' || later.role === 'ui' || later.role === 'system');
    return blocked ? -1 : index;
  }
  return -1;
}

function findLastStreamingBotIndex(messages: Message[], slug: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'assistant' && message.from_slug === slug && message.status === 'streaming') {
      return index;
    }
  }
  return -1;
}

function applySpeaker(messages: Message[], slug: string): Message[] {
  if (findActiveBotIndex(messages, slug) >= 0) {
    return messages;
  }
  return [...messages, createBotMessage(slug, '')];
}

function applyDelta(messages: Message[], slug: string, text: string): Message[] {
  const index = findActiveBotIndex(messages, slug);
  if (index < 0) {
    return [...messages, createBotMessage(slug, text)];
  }
  const next = [...messages];
  next[index] = { ...next[index], text: next[index].text + text };
  return next;
}

function applyTool(messages: Message[], event: ToolEvent): Message[] {
  const payload: ToolPayload = {
    name: event.name,
    label: event.label,
    status: event.status,
    result: event.result,
    untrusted: event.untrusted,
  };
  const toolJson = JSON.stringify(payload);
  const existingIndex = messages.findIndex(
    (message) => message.role === 'tool' && getToolPayload(message)?.label === event.label
  );

  if (existingIndex >= 0) {
    const next = [...messages];
    next[existingIndex] = {
      ...next[existingIndex],
      tool_json: toolJson,
      status: toolStatusToMessageStatus(event.status),
    };
    return next;
  }

  return [
    ...messages,
    {
      id: 0,
      bot_slug: event.slug,
      role: 'tool',
      from_slug: event.slug,
      text: event.label,
      ts: Date.now(),
      status: toolStatusToMessageStatus(event.status),
      tool_json: toolJson,
    },
  ];
}

function applyUi(messages: Message[], event: UiEvent): Message[] {
  const payload: UiPayload = {
    kind: event.kind,
    connector: event.connector,
    items: event.items ?? [],
  };
  return [
    ...messages,
    {
      id: 0,
      bot_slug: event.slug,
      role: 'ui',
      from_slug: event.slug,
      text: event.connector,
      ts: Date.now(),
      status: 'done',
      ui_json: JSON.stringify(payload),
    },
  ];
}

function applyPhase(messages: Message[], text: string, botSlug: string): Message[] {
  return [
    ...messages,
    {
      id: 0,
      bot_slug: botSlug,
      role: 'system',
      from_slug: 'system',
      text,
      ts: Date.now(),
      status: 'done',
    },
  ];
}

function applyDone(messages: Message[], slug: string): Message[] {
  const index = findLastStreamingBotIndex(messages, slug);
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = { ...next[index], status: 'done' };
  return next;
}

function applyError(messages: Message[], text: string, botSlug: string): Message[] {
  return [
    ...messages,
    {
      id: 0,
      bot_slug: botSlug,
      role: 'system',
      from_slug: 'system',
      text,
      ts: Date.now(),
      status: 'error',
    },
  ];
}

/**
 * Applies one stream event to the message list. Pure: it never touches the
 * database and never changes the messages it was given.
 */
export function applyChatEvent(messages: Message[], event: ChatEvent, botSlug: string): Message[] {
  if (isEventOfType<SpeakerEvent>(event, 'speaker')) return applySpeaker(messages, event.slug);
  if (isEventOfType<DeltaEvent>(event, 'delta')) return applyDelta(messages, event.slug, event.text);
  if (isEventOfType<ToolEvent>(event, 'tool')) return applyTool(messages, event);
  if (isEventOfType<UiEvent>(event, 'ui')) return applyUi(messages, event);
  if (isEventOfType<PhaseEvent>(event, 'phase')) return applyPhase(messages, event.text, botSlug);
  if (isEventOfType<DoneEvent>(event, 'done')) return applyDone(messages, event.slug);
  if (isEventOfType<ErrorEvent>(event, 'error')) return applyError(messages, event.message, botSlug);
  return messages;
}

/**
 * Builds the history that is sent to the backend: the last 20 messages that
 * were written by the user or by a bot. Tool chips, cards and dividers are
 * not part of the conversation.
 */
export function buildHistory(messages: Message[], max = 20): ChatHistoryItem[] {
  const eligible = messages.filter((message) => message.role === 'user' || message.role === 'assistant');
  return eligible.slice(-max).map((message) => ({
    role: message.role === 'user' ? 'user' : 'assistant',
    content: message.text,
  }));
}

export interface ChatState {
  messagesByBot: Record<string, Message[]>;
  streamingByBot: Record<string, boolean>;
  errorByBot: Record<string, string | null>;
  thumbsByBot: Record<string, Record<number, boolean>>;
  loadMessages: (slug: string, limit?: number) => void;
  send: (slug: string, text: string, attachments: Attachment[]) => Promise<void>;
  stop: (slug: string) => void;
  retry: (slug: string) => Promise<void>;
  regenerate: (slug: string) => Promise<void>;
  editMessage: (slug: string, messageId: number) => string | null;
  deleteMessage: (slug: string, messageId: number) => void;
  setThumbs: (slug: string, messageId: number, up: boolean) => void;
  clearError: (slug: string) => void;
}

type SetState = (
  partial: ChatState | Partial<ChatState> | ((state: ChatState) => ChatState | Partial<ChatState>)
) => void;
type GetState = () => ChatState;

const controllers = new Map<string, AbortController>();

function toInsertable(message: Message): Omit<Message, 'id'> {
  return {
    bot_slug: message.bot_slug,
    role: message.role,
    from_slug: message.from_slug,
    text: message.text,
    ts: message.ts,
    status: message.status,
    tool_json: message.tool_json,
    ui_json: message.ui_json,
    attachments_json: message.attachments_json,
  };
}

function messageChanged(before: Message, after: Message): boolean {
  return (
    before.text !== after.text ||
    before.status !== after.status ||
    before.tool_json !== after.tool_json ||
    before.ui_json !== after.ui_json
  );
}

function persistMessages(before: Message[], after: Message[]): Message[] {
  const previous = new Map(before.filter((message) => message.id !== 0).map((message) => [message.id, message]));
  const result: Message[] = [];

  for (const message of after) {
    if (message.id === 0) {
      result.push({ ...message, id: insertMessage(toInsertable(message)) });
      continue;
    }
    const old = previous.get(message.id);
    if (old && messageChanged(old, message)) {
      updateMessage(message.id, {
        text: message.text,
        status: message.status,
        tool_json: message.tool_json,
        ui_json: message.ui_json,
      });
    }
    result.push(message);
  }

  return result;
}

function createClient(credentials: StoredCredentials, accessToken: string | null): JasperClient {
  const extraHeaders: Record<string, string> = {};
  if (credentials.cfAccessClientId) extraHeaders['CF-Access-Client-Id'] = credentials.cfAccessClientId;
  if (credentials.cfAccessClientSecret) {
    extraHeaders['CF-Access-Client-Secret'] = credentials.cfAccessClientSecret;
  }
  return new JasperClient(credentials.baseUrl, accessToken ?? undefined, extraHeaders);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function applyEventToStore(slug: string, event: ChatEvent, set: SetState, get: GetState): void {
  const before = get().messagesByBot[slug] ?? [];
  const after = applyChatEvent(before, event, slug);
  if (after === before) return;
  const persisted = persistMessages(before, after);
  set((state) => ({ messagesByBot: { ...state.messagesByBot, [slug]: persisted } }));
}

function closeStreamingMessages(slug: string, set: SetState, get: GetState): void {
  const before = get().messagesByBot[slug] ?? [];
  const after = before.map((message) =>
    message.role === 'assistant' && message.status === 'streaming'
      ? { ...message, status: 'done' as const }
      : message
  );
  if (after === before) return;
  const persisted = persistMessages(before, after);
  set((state) => ({ messagesByBot: { ...state.messagesByBot, [slug]: persisted } }));
}

async function runStream(
  slug: string,
  text: string,
  history: ChatHistoryItem[],
  attachments: Attachment[],
  set: SetState,
  get: GetState
): Promise<void> {
  const auth = useAuth.getState();
  const credentials = auth.credentials;

  if (!credentials) {
    set((state) => ({
      errorByBot: { ...state.errorByBot, [slug]: 'This phone is not paired with a desktop.' },
    }));
    return;
  }

  const controller = new AbortController();
  controllers.set(slug, controller);
  set((state) => ({
    streamingByBot: { ...state.streamingByBot, [slug]: true },
    errorByBot: { ...state.errorByBot, [slug]: null },
  }));

  try {
    const client = createClient(credentials, auth.accessToken);
    const events = await streamChat(
      client,
      { text, slug, history, attachments },
      controller.signal,
      { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret }
    );

    for await (const event of events) {
      applyEventToStore(slug, event, set, get);
    }
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      closeStreamingMessages(slug, set, get);
    } else {
      set((state) => ({
        errorByBot: {
          ...state.errorByBot,
          [slug]: error instanceof Error ? error.message : 'The message could not be sent.',
        },
      }));
    }
  } finally {
    controllers.delete(slug);
    set((state) => ({ streamingByBot: { ...state.streamingByBot, [slug]: false } }));
  }
}

export const useChat = create<ChatState>((set: SetState, get: GetState) => ({
  messagesByBot: {},
  streamingByBot: {},
  errorByBot: {},
  thumbsByBot: {},

  loadMessages: (slug: string, limit = 50): void => {
    initChatDb();
    const messages = listMessages(slug, limit);
    set((state) => ({ messagesByBot: { ...state.messagesByBot, [slug]: messages } }));
  },

  send: async (slug: string, text: string, attachments: Attachment[]): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const existing = get().messagesByBot[slug] ?? [];
    const history = buildHistory(existing);

    const userMessage: Message = {
      id: 0,
      bot_slug: slug,
      role: 'user',
      from_slug: 'you',
      text: trimmed,
      ts: Date.now(),
      status: 'sent',
      attachments_json: attachments.length > 0 ? JSON.stringify(attachments) : undefined,
    };

    const stored: Message = { ...userMessage, id: insertMessage(toInsertable(userMessage)) };
    set((state) => ({ messagesByBot: { ...state.messagesByBot, [slug]: [...existing, stored] } }));

    await runStream(slug, trimmed, history, attachments, set, get);
  },

  stop: (slug: string): void => {
    controllers.get(slug)?.abort();
  },

  retry: async (slug: string): Promise<void> => {
    const messages = get().messagesByBot[slug] ?? [];
    let userIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;

    const userMessage = messages[userIndex];
    for (const message of messages.slice(userIndex + 1)) {
      deleteMessageRow(message.id);
    }
    const remaining = messages.slice(0, userIndex + 1);
    set((state) => ({ messagesByBot: { ...state.messagesByBot, [slug]: remaining } }));

    const history = buildHistory(remaining.slice(0, userIndex));
    await runStream(slug, userMessage.text, history, parseAttachments(userMessage), set, get);
  },

  regenerate: async (slug: string): Promise<void> => {
    const messages = get().messagesByBot[slug] ?? [];
    let botIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') {
        botIndex = index;
        break;
      }
    }
    if (botIndex < 0) return;

    let userIndex = -1;
    for (let index = botIndex - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;

    const userMessage = messages[userIndex];
    for (const message of messages.slice(botIndex)) {
      deleteMessageRow(message.id);
    }
    const remaining = messages.slice(0, botIndex);
    set((state) => ({ messagesByBot: { ...state.messagesByBot, [slug]: remaining } }));

    const history = buildHistory(remaining.slice(0, userIndex));
    await runStream(slug, userMessage.text, history, parseAttachments(userMessage), set, get);
  },

  editMessage: (slug: string, messageId: number): string | null => {
    const messages = get().messagesByBot[slug] ?? [];
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return null;

    const text = messages[index].text;
    deleteMessagesFromId(slug, messageId);
    const remaining = messages.slice(0, index);
    set((state) => ({ messagesByBot: { ...state.messagesByBot, [slug]: remaining } }));
    return text;
  },

  deleteMessage: (slug: string, messageId: number): void => {
    const messages = get().messagesByBot[slug] ?? [];
    deleteMessageRow(messageId);
    set((state) => ({
      messagesByBot: {
        ...state.messagesByBot,
        [slug]: messages.filter((message) => message.id !== messageId),
      },
    }));
  },

  setThumbs: (slug: string, messageId: number, up: boolean): void => {
    set((state) => ({
      thumbsByBot: {
        ...state.thumbsByBot,
        [slug]: { ...(state.thumbsByBot[slug] ?? {}), [messageId]: up },
      },
    }));
  },

  clearError: (slug: string): void => {
    set((state) => ({ errorByBot: { ...state.errorByBot, [slug]: null } }));
  },
}));
