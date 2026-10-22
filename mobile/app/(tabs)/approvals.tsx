import { useCallback } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from 'expo-router';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { ApprovalCard } from '@/components/approvals/ApprovalCard';
import { Button, EmptyState, Screen, Spinner, Text } from '@/components/ui';
import { useApprovals } from '@/store/approvals';
import { theme } from '@/theme/tokens';

const POLL_INTERVAL_MS = 10_000;

export default function ApprovalsScreen() {
  usePreventScreenCapture();

  const requests = useApprovals((state) => state.requests);
  const loading = useApprovals((state) => state.loading);
  const error = useApprovals((state) => state.error);
  const responding = useApprovals((state) => state.responding);
  const load = useApprovals((state) => state.load);
  const respond = useApprovals((state) => state.respond);
  const clearError = useApprovals((state) => state.clearError);

  useFocusEffect(
    useCallback(() => {
      void load();
      const interval = setInterval(() => {
        void load();
      }, POLL_INTERVAL_MS);
      return () => clearInterval(interval);
    }, [load])
  );

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title">Approvals</Text>
        <Text style={styles.count}>
          {requests.length === 0 ? 'Nothing waiting' : `${requests.length} waiting`}
        </Text>
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

      {loading && requests.length === 0 ? (
        <View style={styles.center}>
          <Spinner />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.request_id}
          renderItem={({ item }) => (
            <ApprovalCard
              request={item}
              responding={responding[item.request_id] === true}
              onApprove={() => void respond(item, true)}
              onDeny={() => void respond(item, false)}
            />
          )}
          contentContainerStyle={requests.length === 0 ? styles.emptyList : styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => void load()}
              tintColor={theme.colors.muted}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="No approvals waiting"
              subtitle="Tier 2 and Tier 3 requests from the desktop appear here."
            />
          }
        />
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
  list: {
    paddingBottom: theme.spacing.xl,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
    justifyContent: 'flex-end',
    gap: theme.spacing.sm,
  },
  errorButton: {
    minWidth: 96,
  },
});
