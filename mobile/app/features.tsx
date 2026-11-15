import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Divider, EmptyState, Screen, Spinner, Text } from '@/components/ui';
import { getSession } from '@/api/session';
import type { FeatureCard } from '@/api/types';
import { changeSummary, featureStatus } from '@/utils/diff';
import { theme } from '@/theme/tokens';

function toneColor(tone: 'good' | 'busy' | 'bad'): string {
  if (tone === 'good') return theme.colors.success;
  if (tone === 'bad') return theme.colors.danger;
  return theme.colors.muted;
}

export default function FeaturesScreen() {
  const router = useRouter();
  const [runs, setRuns] = useState<FeatureCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    setLoading(true);
    try {
      setRuns((await session.client.getFeatures(session.creds)).runs);
      setError(null);
    } catch {
      setError("Can't reach your PC right now.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <View style={styles.header}>
        <ScreenHeader title="Feature runs" />
      </View>
      {loading && !runs ? (
        <View style={styles.center}>
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={theme.colors.muted} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {runs && runs.length === 0 ? (
            <EmptyState title="No feature runs" subtitle="Ask Jasper to build something, for example 'build a login page for Boardmint'. Runs appear here with their changes." />
          ) : null}
          {(runs ?? []).map((r) => {
            const st = featureStatus(r.status, r.merge);
            return (
              <View key={r.id}>
                <Pressable
                  onPress={() => router.push(`/feature/${encodeURIComponent(r.id)}` as Href)}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={`Open feature run: ${r.task}`}
                >
                  <View style={[styles.dot, { backgroundColor: toneColor(st.tone) }]} />
                  <View style={styles.rowText}>
                    <Text style={styles.task} numberOfLines={2}>
                      {r.task}
                    </Text>
                    <Text variant="muted">
                      {st.label}
                      {r.files > 0 ? `  ·  ${changeSummary(r.files, r.added, r.removed)}` : ''}
                    </Text>
                  </View>
                </Pressable>
                <Divider />
              </View>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 48, gap: 8 },
  error: { color: theme.colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  rowText: { flex: 1, gap: 3 },
  task: { fontWeight: '600' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
