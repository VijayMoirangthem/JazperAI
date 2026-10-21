import { ChatEvent } from '@/api/types';
import { JasperClient } from '@/api/client';

export async function* readNdjson(response: Response): AsyncGenerator<ChatEvent, void, unknown> {
  if (!response.body) {
    throw new Error('Response has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let parseErrorCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed.t === 'string') {
            yield parsed as ChatEvent;
          }
        } catch {
          parseErrorCount++;
        }
      }
    }

    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        if (parsed && typeof parsed.t === 'string') {
          yield parsed as ChatEvent;
        }
      } catch {
        parseErrorCount++;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function streamChat(
  client: JasperClient,
  body: {
    text: string;
    slug: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    attachments: { name: string; mime: string; text?: string }[];
  },
  signal?: AbortSignal,
  deviceCredentials?: { deviceId: string; deviceSecret: string }
): Promise<AsyncGenerator<ChatEvent, void, unknown>> {
  const response = await client.streamChat(body, deviceCredentials!, signal);

  if (!response.ok) {
    let error: Error;
    if (response.status === 401) {
      error = new Error('Unauthorized');
      error.name = 'AuthRevokedError';
    } else if (response.status === 429) {
      error = new Error('Rate limit exceeded');
      error.name = 'RateLimitError';
    } else {
      error = new Error(`HTTP ${response.status}`);
      error.name = 'HttpError';
    }
    throw error;
  }

  if (!response.body) {
    const fallback = await import('./ndjsonXhr');
    return fallback.streamChatXhr(client, body, signal, deviceCredentials);
  }

  return readNdjson(response);
}