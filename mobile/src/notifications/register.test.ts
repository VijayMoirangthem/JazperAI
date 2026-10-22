import { registerTokenWithRetry } from './register';

describe('registerTokenWithRetry', () => {
  it('registers on the first attempt', async () => {
    const send = jest.fn().mockResolvedValue({ ok: true });

    await expect(registerTokenWithRetry('ExponentPushToken[x]', send)).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('ExponentPushToken[x]');
  });

  it('retries once after a failure', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true });

    await expect(registerTokenWithRetry('ExponentPushToken[x]', send)).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after two failures', async () => {
    const send = jest.fn().mockRejectedValue(new Error('offline'));

    await expect(registerTokenWithRetry('ExponentPushToken[x]', send)).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
