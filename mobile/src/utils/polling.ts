export interface Poller {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
}

export function createPoller(task: () => Promise<void> | void, intervalMs: number): Poller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  let running = false;

  const tick = async () => {
    if (inFlight || !running) return;
    inFlight = true;
    try {
      await task();
    } catch {
      // The task reports its own errors; polling must keep going.
    } finally {
      inFlight = false;
    }
  };

  return {
    start: () => {
      if (running) return;
      running = true;
      void tick();
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    },
    stop: () => {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
    },
    isRunning: () => running,
  };
}
