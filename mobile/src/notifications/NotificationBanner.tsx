import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter, Href } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { Text } from '@/components/ui';
import { useSettings } from '@/store/settings';
import { isNotificationEnabled, notificationType, routeForNotification } from './routing';
import { theme } from '@/theme/tokens';

const AUTO_DISMISS_MS = 5_000;

export function NotificationBanner() {
  const router = useRouter();
  const [notification, setNotification] = useState<Notifications.Notification | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((incoming) => {
      const data = incoming.request.content.data;
      const type = notificationType(data);
      if (!isNotificationEnabled(type, useSettings.getState().notificationToggles)) return;

      setNotification(incoming);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotification(null), AUTO_DISMISS_MS);
    });

    return () => {
      subscription.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  if (!notification) return null;

  const { title, body, data } = notification.request.content;

  const open = () => {
    setNotification(null);
    router.push(routeForNotification(data) as Href);
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        onPress={open}
        style={styles.banner}
        accessibilityRole="button"
        accessibilityLabel="Open notification"
      >
        <Text style={styles.title}>{title ?? 'Jasper'}</Text>
        {body ? (
          <Text style={styles.body} numberOfLines={2}>
            {body}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 56,
    left: theme.spacing.md,
    right: theme.spacing.md,
  },
  banner: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    fontWeight: '600',
  },
  body: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
  },
});
