import * as SecureStore from 'expo-secure-store';

// Where the phone has read up to in the PC's event feed. Shared by the live listener and the 15-minute background task.
const CURSOR_KEY = 'jasper.events.cursor';

export async function loadCursor(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CURSOR_KEY);
  } catch {
    return null;
  }
}

export async function saveCursor(value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(CURSOR_KEY, value);
  } catch {
    // The next run simply starts from "now".
  }
}
