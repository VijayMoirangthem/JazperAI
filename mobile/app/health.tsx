import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button, Divider, Screen, Spinner, Text } from '@/components/ui';
import { getSession } from '@/api/session';
import type { DiagnosticsResponse } from '@/api/types';
import { detailOf, sinceText, sortProblems, summarize, toneOf } from '@/utils/health';
import { theme } from '@/theme/tokens';

function toneColor(tone: 'ok' | 'bad' | 'unknown'): string {
  if (tone === 'ok') return theme.colors.success;
  if (tone === 'bad') return theme.colors.danger;
  return theme.colors.muted;
}

export default function HealthScreen() {
  const [data, setData] = useState<DiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    setLoading(true);
    try {
      setData(await session.client.getDiagnostics(session.creds));
      setError(null);
    } catch {
      setError("Can't reach your PC right now. Check that it is on and Tailscale is connected.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = summarize(data?.checks ?? []);

  return (
    <Screen>
      <View style={styles.header}>
        <ScreenHeader title="System health" />
      </View>
      {loading && !data ? (
        <View style={styles.center}>
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={theme.colors.muted} />}
        >
          {error ? (
            <View style={styles.banner}>
              <Text style={styles.bannerText}>{error}</Text>
              <Button title="Try again" onPress={() => void load()} />
            </View>
          ) : null}

          {data ? (
            <>
              <View style={styles.summary}>
                <View style={[styles.dot, styles.dotBig, { backgroundColor: toneColor(summary.tone) }]} />
                <Text style={styles.summaryText}>{summary.text}</Text>
              </View>

              {data.checks.map((c) => (
                <View key={c.name}>
                  <View style={styles.row} accessibilityLabel={`${c.label}: ${c.ok === true ? 'working' : c.ok === false ? 'problem' : 'checking'}`}>
                    <View style={[styles.dot, { backgroundColor: toneColor(toneOf(c)) }]} />
                    <View style={styles.rowText}>
                      <Text style={styles.rowTitle}>{c.label}</Text>
                      {detailOf(c) ? <Text variant="muted">{detailOf(c)}</Text> : null}
                    </View>
                    {c.ok === false ? <Text variant="muted">{sinceText(c.since)}</Text> : null}
                  </View>
                  <Divider />
                </View>
              ))}

              <Text style={styles.section}>Recent problems</Text>
              {data.problems.length === 0 ? (
                <Text variant="muted">Nothing in the log. Good.</Text>
              ) : (
                sortProblems(data.problems).map((p, i) => (
                  <View key={`${p.time}-${i}`} style={styles.problem}>
                    <View style={styles.problemTop}>
                      <Text style={{ ...styles.level, color: p.level === 'error' ? theme.colors.danger : theme.colors.muted }}>
                        {p.level === 'error' ? 'Error' : 'Warning'}
                      </Text>
                      <Text variant="muted">
                        {p.time.slice(5, 16)}
                        {p.count > 1 ? `  x${p.count}` : ''}
                      </Text>
                    </View>
                    <Text numberOfLines={3}>{p.message}</Text>
                  </View>
                ))
              )}
            </>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 48, gap: 12 },
  banner: { padding: 14, borderRadius: 14, backgroundColor: theme.colors.surface, gap: 10 },
  bannerText: { color: theme.colors.danger },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  summaryText: { fontSize: theme.fontSizes.lg, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontWeight: '600' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotBig: { width: 14, height: 14, borderRadius: 7 },
  section: { fontSize: theme.fontSizes.lg, fontWeight: '600', marginTop: 16 },
  problem: { paddingVertical: 10, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.colors.border },
  problemTop: { flexDirection: 'row', justifyContent: 'space-between' },
  level: { fontWeight: '600' },
});
