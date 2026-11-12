import { Platform } from 'react-native';
import BackgroundService from 'react-native-background-actions';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { AuthRevokedError, JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { useSettings } from '@/store/settings';
import { useApprovals } from '@/store/approvals';
import { ensureChannels } from './setup';
import { SeenIds, nextBackoff, notificationForEvent } from './events';

// Jasper's own push channel. A foreground service keeps ONE request open to the PC (long-poll over the private Tailscale link) and turns
// each new event into a normal Android notification. No Google/Expo/Telegram push service. The service shows one quiet persistent
// notification ("Jasper is listening"); Android requires that for anything that runs while the app is closed.

const CURSOR_KEY = 'jasper.events.cursor';
const WAIT_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 45_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function loadCursor(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CURSOR_KEY);
  } catch {
    return null;
  }
}

async function saveCursor(value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(CURSOR_KEY, value);
  } catch {
    // The next start simply begins from "now".
  }
}

function clientFor(baseUrl: string, token: string | null, creds: { cfAccessClientId?: string; cfAccessClientSecret?: string }) {
  const extra: Record<string, string> = {};
  if (creds.cfAccessClientId) extra['CF-Access-Client-Id'] = creds.cfAccessClientId;
  if (creds.cfAccessClientSecret) extra['CF-Access-Client-Secret'] = creds.cfAccessClientSecret;
  return new JasperClient(baseUrl, token ?? undefined, extra);
}

async function listen(): Promise<void> {
  const seen = new SeenIds();
  let cursor = await loadCursor();
  let backoff = 0;
  let client: JasperClient | null = null;
  let clientKey = '';

  while (BackgroundService.isRunning()) {
    const { credentials, accessToken } = useAuth.getState();
    if (!credentials) {
      await sleep(5000);
      continue;
    }
    const key = `${credentials.baseUrl}|${credentials.deviceId}`;
    if (!client || key !== clientKey) {
      client = clientFor(credentials.baseUrl, accessToken, credentials);
      clientKey = key;
    }
    const creds = { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret };

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await client.getEvents(cursor, creds, WAIT_SECONDS, abort.signal);
      backoff = 0;
      const first = cursor === null;
      cursor = res.cursor;
      await saveCursor(cursor);
      if (first) continue; // the very first call only establishes "now"; older events are not replayed
      const toggles = useSettings.getState().notificationToggles;
      for (const ev of res.events) {
        if (!seen.add(ev.id)) continue;
        if (ev.kind === 'approval') void useApprovals.getState().load();
        const n = notificationForEvent(ev, toggles);
        if (!n) continue;
        await Notifications.scheduleNotificationAsync({
          content: { title: n.title, body: n.body, data: n.data },
          trigger: { channelId: n.channelId },
        });
      }
    } catch (err) {
      if (err instanceof AuthRevokedError) {
        // This phone was removed on the PC: stop listening instead of retrying forever.
        await stopListener();
        return;
      }
      backoff = nextBackoff(backoff);
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function startListener(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  if (BackgroundService.isRunning()) return true;
  try {
    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      if (asked.status !== 'granted') return false;
    }
    await ensureChannels();
    await BackgroundService.start(listen, {
      taskName: 'JasperListener',
      taskTitle: 'Jasper is listening',
      taskDesc: 'Alerts from your PC arrive here',
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      color: '#111111',
      foregroundServiceType: ['remoteMessaging'],
    } as Parameters<typeof BackgroundService.start>[1]);
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[listener] could not start', err);
    return false;
  }
}

export async function stopListener(): Promise<void> {
  try {
    if (BackgroundService.isRunning()) await BackgroundService.stop();
  } catch {
    // Already stopped.
  }
}
