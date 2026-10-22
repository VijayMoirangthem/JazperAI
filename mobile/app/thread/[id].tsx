import React, { useCallback } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CommsMessage } from '@/api/types';
import { useThread } from '@/store/thread';
import { createPoller } from '@/utils/polling';
import { THREAD_POLL_MS, isMonospaceKind } from '@/utils/activity';
import { Button, Divider, EmptyState, Screen, Spinner, Text } from '@/components/ui';
import { theme } from '@/theme/tokens';

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { timeStyle: 'short' });
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const threadId = typeof id === 'string' ? id : '';
  const router = useRouter();
  const { messages, loading, error, open, load, close, clearError } = useThread();

  useFocusEffect(
    useCallback(() => {
      if (!threadId) return;

      open(threadId);
      const poller = createPoller(() => load(threadId), THREAD_POLL_MS);
      poller.start();

      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') poller.start();
        else poller.stop();
      });

      return () => {
        poller.stop();
        subscription.remove();
        close();
      };
    }, [threadId, open, load, close])
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={styles.back}
        >
          <Text style={styles.backText}>{'\u2039'} Back</Text>
        </Pressable>
        <Text variant="title" style={styles.title} numberOfLines={1}>
          {threadId}
        </Text>
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <Button title="Dismiss" variant="secondary" onPress={clearError} style={styles.errorButton} />
            <Button title="Retry" onPress={() => void load(threadId)} style={styles.errorButton} />
          </View>
        </View>
      ) : null}

      {loading && messages.length === 0 ? (
        <View style={styles.center}>
          <Spinner />
        </View>
      ) : (
        <View style={styles.list}>
          {messages.length === 0 ? (
            <EmptyState
              title="No messages yet"
              subtitle="This conversation updates every few seconds while it is open."
            />
          ) : (
            messages.map((message: CommsMessage) => (
              <View key={message.id}>
                <View style={styles.message}>
                  <View style={styles.metaRow}>
                    <Text style={styles.meta}>
                      {message.from_slug} {'\u2192'} {message.to_slug}
                    </Text>
                    <Text style={styles.meta}>
                      {message.kind} {'\u00b7'} {formatTime(message.ts)}
                    </Text>
                  </View>
                  <Text style={isMonospaceKind(message.kind) ? styles.mono : styles.text}>
                    {message.text}
                  </Text>
                </View>
                <Divider />
              </View>
            ))
          )}
        </View>
      )}

      <StatusBar style="light" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  back: {
    paddingVertical: theme.spacing.xs,
  },
  backText: {
    color: theme.colors.accent,
    fontSize: theme.fontSizes.base,
  },
  title: {
    flex: 1,
    fontSize: theme.fontSizes.lg,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    paddingHorizontal: theme.spacing.md,
  },
  message: {
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  meta: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  text: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    lineHeight: 21,
  },
  mono: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
    fontFamily: 'monospace',
    lineHeight: 19,
  },
  errorBanner: {
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    padding: theme.spacing.md,
    borderRadius: theme.radii.button,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.danger,
    gap: theme.spacing.sm,
  },
  errorText: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.sm,
  },
  errorActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  errorButton: {
    flex: 1,
  },
});
