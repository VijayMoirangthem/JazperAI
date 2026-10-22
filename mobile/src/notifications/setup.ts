import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { registerTokenWithRetry } from './register';

let registeredToken: string | null = null;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

export function configureNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('approvals', {
    name: 'Approvals',
    importance: AndroidImportance.MAX,
  });
  await Notifications.setNotificationChannelAsync('general', {
    name: 'General',
    importance: AndroidImportance.DEFAULT,
  });
}

export async function registerForPushNotifications(): Promise<string | null> {
  const { credentials, accessToken } = useAuth.getState();
  if (!credentials) return null;

  try {
    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return null;

    await ensureChannels();

    const id = projectId();
    if (!id) {
      if (__DEV__) {
        console.warn('[notifications] no EAS projectId configured; push registration skipped');
      }
      return null;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    if (token === registeredToken) return token;

    const extraHeaders: Record<string, string> = {};
    if (credentials.cfAccessClientId) {
      extraHeaders['CF-Access-Client-Id'] = credentials.cfAccessClientId;
    }
    if (credentials.cfAccessClientSecret) {
      extraHeaders['CF-Access-Client-Secret'] = credentials.cfAccessClientSecret;
    }
    const client = new JasperClient(credentials.baseUrl, accessToken ?? undefined, extraHeaders);

    const registered = await registerTokenWithRetry(token, (value) =>
      client.registerPushToken(value, {
        deviceId: credentials.deviceId,
        deviceSecret: credentials.deviceSecret,
      })
    );
    if (!registered) return null;

    registeredToken = token;
    return token;
  } catch (err) {
    if (__DEV__) {
      console.warn('[notifications] registration failed', err);
    }
    return null;
  }
}
