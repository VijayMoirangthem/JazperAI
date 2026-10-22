import { setStringAsync } from 'expo-clipboard';

/** Copies text to the phone clipboard. Returns false when the copy failed. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    await setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
