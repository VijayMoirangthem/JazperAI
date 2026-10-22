import React, { useCallback } from 'react';
import { AppState, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter, Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { CommsThread, SLO } from '@/api/types';
import { useActivity } from '@/store/activity';
import { createPoller } from '@/utils/polling';
import {
  ACTIVITY_POLL_MS,
  formatBudget,
  statusLabel,
  threadTitle,
} from '@/utils/activity';
import { Button, Divider, EmptyState, Screen, Spinner, Text } from '@/components/ui';
import { theme } from '@/theme/tokens';

function statusColor(status: SLO['status']): string {
  if (status === 'ok') return theme.colors.success;
  if (status === 'breached') return theme.colors.danger;
  return theme.colors.muted;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

export default function ActivityScreen() {
  const router = useRouter();
  const { status, threads, loading, error, load, clearError } = useActivity();

  useFocusEffect(
    useCallback(() => {
      const poller = createPoller(load, ACTIVITY_POLL_MS);
      poller.start();

      const subscription = AppState.addEventListener('change', (next) => {
        if (next === 'active') poller.start();
        else poller.stop();
      });

      return () => {
        poller.stop();
        subscription.remove();
      };
    }, [load])
  );

  const openThread = (thread: CommsThread) => {
    router.push(`/thread/${encodeURIComponent(thread.thread)}` as Href);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Activity</Text>
        {status ? (
          <Text style={styles.count}>{status.pending_approvals} pending</Text>
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <View style={styles.errorActions}>
            <Button title="Dismiss" variant="secondary" onPress={clearError} style={styles.errorButton} />
            <Button title="Retry" onPress={() => void load()} style={styles.errorButton} />
          </View>
        </View>
      ) : null}

      {loading && !status ? (
        <View style={styles.center}>
          <Spinner />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.tiles}>
            {status?.slos.map((slo) => (
              <View key={slo.slo} style={styles.tile}>
                <Text style={styles.tileName} numberOfLines={1}>
                  {slo.slo}
                </Text>
                <View style={styles.statusRow}>
                  <View style={[styles.dot, { backgroundColor: statusColor(slo.status) }]} />
                  <Text style={styles.statusText}>{statusLabel(slo.status)}</Text>
                </View>
                <Text style={styles.budgetText}>Budget {formatBudget(slo.budget_remaining)}</Text>
              </View>
            ))}

            {status ? (
              <View style={styles.tile}>
                <Text style={styles.tileName}>Pending approvals</Text>
                <Text style={styles.pendingValue}>{status.pending_approvals}</Text>
                <Text style={styles.budgetText}>Waiting for a decision</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.sectionTitle}>Conversations</Text>

          {threads.length === 0 ? (
            <EmptyState
              title="No activity yet"
              subtitle="Bot-to-bot conversations from the desktop appear here."
            />
          ) : (
            <View>
              {threads.map((thread) => (
                <View key={thread.thread}>
                  <Pressable
                    onPress={() => openThread(thread)}
                    style={styles.threadRow}
                    accessibilityRole="button"
                    accessibilityLabel={`Open conversation ${threadTitle(thread.from_slug, thread.to_slug)}`}
                  >
                    <View style={styles.threadHeader}>
                      <Text style={styles.threadTitle} numberOfLines={1}>
                        {threadTitle(thread.from_slug, thread.to_slug)}
                      </Text>
                      <Text style={styles.threadTime}>{formatTime(thread.ts)}</Text>
                    </View>
                    <Text variant="muted" numberOfLines={2} style={styles.preview}>
                      {thread.preview}
                    </Text>
                    <Text style={styles.threadMeta}>
                      {thread.kind} {'\u00b7'} {thread.n} {thread.n === 1 ? 'message' : 'messages'}
                    </Text>
                  </Pressable>
                  <Divider />
                </View>
              ))}
            </View>
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
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  count: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing.md,
  },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    padding: theme.spacing.md,
    borderRadius: theme.radii.card,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: theme.spacing.xs,
  },
  tileName: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.sm,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.sm,
  },
  budgetText: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
  },
  pendingValue: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.xl,
    fontWeight: '700',
  },
  sectionTitle: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: theme.spacing.sm,
  },
  threadRow: {
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
  },
  threadTitle: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    fontWeight: '600',
    flexShrink: 1,
  },
  threadTime: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
  },
  preview: {
    fontSize: theme.fontSizes.sm,
  },
  threadMeta: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
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
