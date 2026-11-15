import * as TaskManager from 'expo-task-manager';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { JasperClient } from '@/api/client';
import { loadCredentials } from '@/auth/secureStore';
import { useSettings } from '@/store/settings';
import { loadCursor, saveCursor } from './cursor';
import { pollOnce } from './poll';
import { ensureNotificationCategories } from './setup';

// The safety net behind the live listener: Android runs this about every 15 minutes (the system decides the exact time) and restarts the
// schedule after a phone reboot, so alerts still arrive when the listener service is not running. Imported from index.ts so the task is
// defined when Android starts the app headless.
export const EVENTS_TASK = 'jasper-events-poll';

TaskManager.defineTask(EVENTS_TASK, async () => {
  try {
    await useSettings.persist.rehydrate(); // a headless run starts with empty stores
    if (!useSettings.getState().backgroundAlerts) return BackgroundTask.BackgroundTaskResult.Success;
    await pollOnce({
      loadCredentials,
      getEvents: (creds, since) =>
        new JasperClient(creds.baseUrl).getEvents(since, { deviceId: creds.deviceId, deviceSecret: creds.deviceSecret }, 0),
      loadCursor,
      saveCursor,
      loadToggles: async () => useSettings.getState().notificationToggles,
      show: async (n) => {
        await ensureNotificationCategories();
        await Notifications.scheduleNotificationAsync({
          content: { title: n.title, body: n.body, data: n.data, ...(n.categoryId ? { categoryIdentifier: n.categoryId } : {}) },
          trigger: { channelId: n.channelId },
        });
      },
    });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed; // Android will try again at the next window
  }
});

export async function registerBackgroundPoll(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(EVENTS_TASK)) return;
    await BackgroundTask.registerTaskAsync(EVENTS_TASK, { minimumInterval: 15 });
  } catch (err) {
    if (__DEV__) console.warn('[background poll] could not register', err);
  }
}

export async function unregisterBackgroundPoll(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(EVENTS_TASK)) await BackgroundTask.unregisterTaskAsync(EVENTS_TASK);
  } catch {
    // Already gone.
  }
}
