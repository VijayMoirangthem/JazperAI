export async function registerTokenWithRetry(
  token: string,
  send: (token: string) => Promise<unknown>,
  attempts = 2
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await send(token);
      return true;
    } catch {
      // Try again once; the caller reports failure after the final attempt.
    }
  }
  return false;
}
