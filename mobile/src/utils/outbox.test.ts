import { drainOutbox, resetOutboxGuard } from './outbox';

describe('drainOutbox', () => {
  beforeEach(() => {
    resetOutboxGuard();
  });

  it('sends oldest first, one at a time', async () => {
    const order: number[] = [];
    const removed: number[] = [];

    const result = await drainOutbox(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      async (item) => {
        order.push(item.id);
      },
      (id) => removed.push(id)
    );

    expect(order).toEqual([1, 2, 3]);
    expect(removed).toEqual([1, 2, 3]);
    expect(result).toEqual({ sent: 3, failed: false });
  });

  it('stops at the first failure and keeps the rest queued', async () => {
    const sent: number[] = [];
    const removed: number[] = [];

    const result = await drainOutbox(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      async (item) => {
        if (item.id === 2) throw new Error('offline');
        sent.push(item.id);
      },
      (id) => removed.push(id)
    );

    expect(sent).toEqual([1]);
    expect(removed).toEqual([1]);
    expect(result).toEqual({ sent: 1, failed: true });
  });

  it('retries a failed item on the next run', async () => {
    const sent: number[] = [];
    let online = false;

    const send = async (item: { id: number }) => {
      if (!online) throw new Error('offline');
      sent.push(item.id);
    };

    const first = await drainOutbox([{ id: 1 }], send, () => undefined);
    online = true;
    const second = await drainOutbox([{ id: 1 }], send, () => undefined);

    expect(first.failed).toBe(true);
    expect(second).toEqual({ sent: 1, failed: false });
    expect(sent).toEqual([1]);
  });

  it('never sends the same outbox id twice', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn();

    const result = await drainOutbox([{ id: 5 }, { id: 5 }], send, remove);

    expect(send).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, failed: false });
  });

  it('skips an id that a stale list already sent', async () => {
    const send = jest.fn().mockResolvedValue(undefined);

    await drainOutbox([{ id: 9 }], send, () => undefined);
    await drainOutbox([{ id: 9 }], send, () => undefined);

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty queue', async () => {
    const send = jest.fn().mockResolvedValue(undefined);

    const result = await drainOutbox([], send, () => undefined);

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: false });
  });
});
