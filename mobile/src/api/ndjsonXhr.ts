import { ChatEvent } from '@/api/types';
import { JasperClient } from '@/api/client';

interface ClientInternals {
  baseUrl: string;
  accessToken: string | null;
  extraHeaders: Record<string, string>;
}

export function streamChatXhr(
  client: JasperClient,
  body: {
    text: string;
    slug: string;
    history: { role: 'user' | 'assistant'; content: string }[];
    attachments: { name: string; mime: string; text?: string }[];
  },
  signal?: AbortSignal,
  deviceCredentials?: { deviceId: string; deviceSecret: string }
): AsyncGenerator<ChatEvent, void, unknown> {
  const internals = client as unknown as ClientInternals;
  const baseUrl = internals.baseUrl;
  const accessToken = internals.accessToken;
  const extraHeaders = internals.extraHeaders;

  return (async function* () {
    const xhr = new XMLHttpRequest();
    let buffer = '';
    let lastLength = 0;
    let parseErrorCount = 0;

    xhr.open('POST', `${baseUrl}/remote/v1/chat/stream`, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    Object.entries(extraHeaders).forEach(([key, value]) => {
      xhr.setRequestHeader(key, value);
    });
    if (accessToken) {
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    }

    const events: ChatEvent[] = [];

    xhr.onprogress = () => {
      const chunk = xhr.responseText.slice(lastLength);
      lastLength = xhr.responseText.length;
      buffer += chunk;

      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (!line) continue;

        try {
          const parsed = JSON.parse(line);
          if (parsed && typeof parsed.t === 'string') {
            events.push(parsed as ChatEvent);
          }
        } catch {
          parseErrorCount++;
        }
      }
    };

    await new Promise<void>((resolve, reject) => {
      xhr.onload = () => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            if (parsed && typeof parsed.t === 'string') {
              events.push(parsed as ChatEvent);
            }
          } catch {
            parseErrorCount++;
          }
        }
        if (xhr.status >= 400) {
          let error: Error;
          if (xhr.status === 401) {
            error = new Error('Unauthorized');
            error.name = 'AuthRevokedError';
          } else if (xhr.status === 429) {
            error = new Error('Rate limit exceeded');
            error.name = 'RateLimitError';
          } else {
            error = new Error(`HTTP ${xhr.status}`);
            error.name = 'HttpError';
          }
          reject(error);
          return;
        }
        resolve();
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onabort = () => reject(new Error('Aborted'));

      if (signal) {
        signal.addEventListener('abort', () => xhr.abort());
      }

      xhr.send(JSON.stringify(body));
    });

    for (const event of events) {
      yield event;
    }
  })();
}