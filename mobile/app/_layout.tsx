import { Stack, useRouter, Href, ErrorBoundaryProps } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/auth/useAuth';
import { loadCredentials, clearCredentials } from '@/auth/secureStore';
import { JasperClient, AuthRevokedError } from '@/api/client';
import { useApprovals } from '@/store/approvals';
import { useSettings } from '@/store/settings';
import { useChat } from '@/store/chat';
import { useSystem } from '@/store/system';
import { configureNotifications, registerForPushNotifications } from '@/notifications/setup';
import {
  isNotificationEnabled,
  notificationType,
  routeForNotification,
} from '@/notifications/routing';
import { NotificationBanner } from '@/notifications/NotificationBanner';
import { SystemBanner } from '@/components/SystemBanner';
import { RootError } from '@/components/RootError';
import { startOutboxRetries } from '@/outbox/retry';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return <RootError error={error} retry={retry} />;
}

export default function RootLayout() {
  const { hydrated, credentials, setTokens, setCredentials, clear } = useAuth();
  const [initializing, setInitializing] = useState(true);
  const router = useRouter();
  const toggles = useSettings((state) => state.notificationToggles);
  const bannerKind = useSystem((state) => state.banner?.kind ?? null);
  const lastResponse = Notifications.useLastNotificationResponse();
  const handledResponse = useRef<string | null>(null);

  useEffect(() => {
    configureNotifications();
  }, []);

  useEffect(() => {
    return startOutboxRetries(() => {
      void useChat.getState().flushOutbox();
    });
  }, []);

  useEffect(() => {
    if (bannerKind !== 'unpaired') return;

    let cancelled = false;
    void (async () => {
      await clearCredentials();
      if (cancelled) return;
      clear();
      router.replace('/(auth)/pair' as Href);
    })();

    return () => {
      cancelled = true;
    };
  }, [bannerKind, clear, router]);

  useEffect(() => {
    if (!credentials) return;

    void registerForPushNotifications();

    const received = Notifications.addNotificationReceivedListener((notification) => {
      if (notificationType(notification.request.content.data) === 'approval') {
        void useApprovals.getState().load();
      }
    });
    const tokenChanged = Notifications.addPushTokenListener(() => {
      void registerForPushNotifications();
    });

    return () => {
      received.remove();
      tokenChanged.remove();
    };
  }, [credentials]);

  useEffect(() => {
    if (!lastResponse || initializing) return;

    const identifier = lastResponse.notification.request.identifier;
    if (handledResponse.current === identifier) return;
    handledResponse.current = identifier;

    if (!credentials) return;
    const data = lastResponse.notification.request.content.data;
    if (!isNotificationEnabled(notificationType(data), toggles)) return;

    router.push(routeForNotification(data) as Href);
  }, [lastResponse, initializing, credentials, toggles, router]);

  useEffect(() => {
    const initialize = async () => {
      if (!hydrated) return;

      const credentials = await loadCredentials();
      if (!credentials) {
        setInitializing(false);
        return;
      }

      try {
        const client = new JasperClient(credentials.baseUrl);
        const refreshResponse = await client.refresh(credentials.deviceId, credentials.deviceSecret);
        const meResponse = await client.me({ deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret });

        setCredentials(credentials);
        setTokens(refreshResponse.access_token, credentials.deviceId, meResponse.name);
      } catch (err) {
        if (err instanceof AuthRevokedError || (err instanceof Error && err.message.includes('401'))) {
          await clearCredentials();
          clear();
        }
      } finally {
        setInitializing(false);
      }
    };

    initialize();
  }, [hydrated, setTokens, setCredentials, clear]);

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="(auth)/pair" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[slug]" />
        <Stack.Screen name="bot/[slug]" />
        <Stack.Screen name="thread/[id]" />
      </Stack>
      <NotificationBanner />
      <SystemBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0b0b0b',
    justifyContent: 'center',
    alignItems: 'center',
  },
});