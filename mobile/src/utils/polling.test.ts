import { createPoller } from './polling';

describe('createPoller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs immediately and then on every interval', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const poller = createPoller(task, 15_000);

    poller.start();
    expect(task).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(task).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(15_000);
    expect(task).toHaveBeenCalledTimes(3);

    poller.stop();
  });

  it('stops polling after stop', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const poller = createPoller(task, 3_000);

    poller.start();
    poller.stop();
    expect(poller.isRunning()).toBe(false);

    await jest.advanceTimersByTimeAsync(9_000);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('does not overlap a slow request', async () => {
    let resolveTask: (() => void) | undefined;
    const task = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveTask = resolve;
        })
    );
    const poller = createPoller(task, 1_000);

    poller.start();
    await jest.advanceTimersByTimeAsync(3_000);
    expect(task).toHaveBeenCalledTimes(1);

    resolveTask?.();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('does not start twice', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const poller = createPoller(task, 1_000);

    poller.start();
    poller.start();
    expect(task).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it('resumes after stop and start', async () => {
    const task = jest.fn().mockResolvedValue(undefined);
    const poller = createPoller(task, 1_000);

    poller.start();
    poller.stop();
    await jest.advanceTimersByTimeAsync(0);
    poller.start();
    expect(task).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(1_000);
    expect(task).toHaveBeenCalledTimes(3);

    poller.stop();
  });
});
