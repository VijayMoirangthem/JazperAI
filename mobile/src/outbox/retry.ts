import { AppState } from 'react-native';

export const OUTBOX_RETRY_MS = 10_000;

/**
 * Retries the outbox when the app comes back to the foreground and on a slow
 * timer, which also covers connectivity coming back while the app stays open.
 */
export function startOutboxRetries(flush: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') flush();
  });
  const timer = setInterval(flush, OUTBOX_RETRY_MS);

  flush();

  return () => {
    subscription.remove();
    clearInterval(timer);
  };
}
