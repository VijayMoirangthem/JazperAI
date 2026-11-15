import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button, Screen, Spinner, Text } from '@/components/ui';
import { useToast } from '@/components/ui/kit';
import { getSession } from '@/api/session';
import type { FeatureDetail } from '@/api/types';
import { changeSummary, featureStatus, renderDiff, type DiffLineKind } from '@/utils/diff';
import { theme } from '@/theme/tokens';

const LINE_BG: Record<DiffLineKind, string | undefined> = {
  add: 'rgba(40,167,69,0.14)',
  del: 'rgba(220,53,69,0.14)',
  hunk: 'rgba(120,120,120,0.10)',
  file: undefined,
  ctx: undefined,
};

export default function FeatureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const [run, setRun] = useState<FeatureDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const session = getSession();
    if (!session || !id) return;
    setLoading(true);
    try {
      setRun(await session.client.getFeature(String(id), session.creds));
      setError(null);
    } catch {
      setError('Could not load this run. It may have been discarded.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const requestMerge = () => {
    Alert.alert(
      'Ask to merge?',
      'This only sends an approval request to your Approvals tab. Nothing changes until you approve it there with your fingerprint.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send request',
          onPress: async () => {
            const session = getSession();
            if (!session || !run) return;
            setBusy(true);
            try {
              await session.client.requestFeatureMerge(run.id, session.creds);
              toast('Approval requested. Open Approvals to decide.');
              router.push('/approvals' as Href);
            } catch {
              toast('Could not request the merge.');
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const discard = () => {
    Alert.alert('Discard this run?', 'Its branch is deleted. Nothing was merged, so nothing is lost.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: async () => {
          const session = getSession();
          if (!session || !run) return;
          setBusy(true);
          try {
            await session.client.discardFeature(run.id, session.creds);
            toast('Run discarded');
            router.back();
          } catch {
            toast('Could not discard it.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const st = run ? featureStatus(run.status, run.merge) : null;
  const canMerge = run?.status === 'verified' && !run.merge;
  const canDiscard = !!run && run.merge !== 'merged';

  return (
    <Screen>
      <View style={styles.header}>
        <ScreenHeader title="Feature run" />
      </View>
      {loading && !run ? (
        <View style={styles.center}>
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={theme.colors.muted} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {run && st ? (
            <>
              <Text style={styles.task}>{run.task}</Text>
              <Text variant="muted">
                {st.label}
                {'  ·  '}
                {changeSummary(run.files, run.added, run.removed)}
              </Text>
              {run.report ? <Text>{run.report}</Text> : null}

              {run.files_changed.map((f) => (
                <Text key={f.path} variant="muted">
                  {f.path}  +{f.added} -{f.removed}
                </Text>
              ))}

              <View style={styles.actions}>
                {canMerge ? <Button title="Ask to merge" onPress={requestMerge} disabled={busy} /> : null}
                {canDiscard ? <Button title="Discard run" variant="secondary" onPress={discard} disabled={busy} /> : null}
              </View>

              <Text style={styles.section}>Changes</Text>
              {run.diff ? (
                <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.codeScroll}>
                  <View>
                    {renderDiff(run.diff).map((l, i) => (
                      <Text
                        key={i}
                        style={{
                          ...styles.code,
                          backgroundColor: LINE_BG[l.kind],
                          fontWeight: l.kind === 'file' ? '700' : '400',
                          color: l.kind === 'file' ? theme.colors.text : l.kind === 'hunk' ? theme.colors.muted : theme.colors.text,
                        }}
                      >
                        {l.kind === 'file' ? `── ${l.text}` : l.text}
                      </Text>
                    ))}
                  </View>
                </ScrollView>
              ) : (
                <Text variant="muted">No changes yet.</Text>
              )}
              {run.diff_cut ? <Text variant="muted">The diff is long: only the first part is shown here. See the rest on the PC.</Text> : null}
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
  body: { padding: 16, paddingBottom: 48, gap: 10 },
  error: { color: theme.colors.danger },
  task: { fontSize: theme.fontSizes.lg, fontWeight: '600' },
  section: { fontSize: theme.fontSizes.lg, fontWeight: '600', marginTop: 12 },
  actions: { gap: 10, marginTop: 8 },
  codeScroll: { paddingRight: 16 },
  code: { fontFamily: 'monospace', fontSize: 12, lineHeight: 17 },
});
