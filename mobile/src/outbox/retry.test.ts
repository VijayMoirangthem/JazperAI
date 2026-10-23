import { AppState } from 'react-native';
import { OUTBOX_RETRY_MS, startOutboxRetries } from './retry';

type AppStateListener = (state: 'active' | 'background' | 'inactive') => void;

describe('startOutboxRetries', () => {
  let listener: AppStateListener | undefined;
  let remove: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    remove = jest.fn();
    listener = undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handler) => {
      listener = handler as AppStateListener;
      return { remove } as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('flushes immediately, on the timer and when the app becomes active', async () => {
    const flush = jest.fn();
    const stop = startOutboxRetries(flush);

    expect(flush).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(OUTBOX_RETRY_MS);
    expect(flush).toHaveBeenCalledTimes(2);

    listener?.('background');
    expect(flush).toHaveBeenCalledTimes(2);

    listener?.('active');
    expect(flush).toHaveBeenCalledTimes(3);

    stop();
  });

  it('removes the listener and timer on stop', async () => {
    const flush = jest.fn();
    const stop = startOutboxRetries(flush);

    stop();

    await jest.advanceTimersByTimeAsync(OUTBOX_RETRY_MS * 3);
    listener?.('active');

    expect(remove).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});
