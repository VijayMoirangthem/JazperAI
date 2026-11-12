import { theme } from '@/theme/tokens';
import { Stack, useRouter, Href, ErrorBoundaryProps } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/auth/useAuth';
import { getAuthProvider } from '@/auth/AuthProvider';
import { initMetaDb } from '@/db/meta';
import { useHome } from '@/store/home';
import { ToastHost } from '@/components/ui/kit';
import { AppLockGate } from '@/components/AppLockGate';
import { StatusBar } from 'expo-status-bar';
import { JasperClient, AuthRevokedError } from '@/api/client';
import { useApprovals } from '@/store/approvals';
import { useSettings } from '@/store/settings';
import { useChat } from '@/store/chat';
import { useSystem } from '@/store/system';
import { configureNotifications, registerForPushNotifications } from '@/notifications/setup';
import { startListener, stopListener } from '@/notifications/listener';
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
  const { hydrated, credentials, clear } = useAuth();
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
      await getAuthProvider().signOut();
      if (cancelled) return;
      clear();
      router.replace('/welcome' as Href);
    })();

    return () => {
      cancelled = true;
    };
  }, [bannerKind, clear, router]);

  useEffect(() => {
    if (!credentials) return;

    void registerForPushNotifications();
    void startListener(); // Jasper's own push: the PC tells the phone directly, no third-party service

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
    if (!credentials) void stopListener();
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
      try {
        initMetaDb();
        useHome.getState().refresh();
      } catch {
        // The local database is rebuilt on the next launch if it could not open.
      }
      try {
        await getAuthProvider().restore();
      } catch (err) {
        if (err instanceof AuthRevokedError || (err instanceof Error && err.message.includes('401'))) {
          await getAuthProvider().signOut();
        }
      } finally {
        setInitializing(false);
      }
    };

    initialize();
  }, [hydrated]);

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={theme.colors.accent} />
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
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" options={{ animation: 'fade' }} />
        <Stack.Screen name="(auth)/pair" />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="chat/[slug]" />
        <Stack.Screen name="bot/[slug]" />
        <Stack.Screen name="thread/[id]" />
        <Stack.Screen name="search" options={{ animation: 'fade' }} />
        <Stack.Screen name="create-bot" options={{ presentation: 'transparentModal', animation: 'none' }} />
        <Stack.Screen name="plugins" options={{ presentation: 'transparentModal', animation: 'none' }} />
        <Stack.Screen name="profile" options={{ presentation: 'transparentModal', animation: 'none' }} />
        <Stack.Screen name="menu" options={{ presentation: 'transparentModal', animation: 'none' }} />
      </Stack>
      <StatusBar style={theme.isDark ? "light" : "dark"} />
      <ToastHost />
      <AppLockGate />
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
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});