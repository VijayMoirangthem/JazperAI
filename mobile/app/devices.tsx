import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { Button, Divider, Screen, Spinner, Text } from '@/components/ui';
import { useToast } from '@/components/ui/kit';
import { getSession } from '@/api/session';
import type { PairedDevice } from '@/api/types';
import { isStale, lastSeenText, sortDevices } from '@/utils/devices';
import { theme } from '@/theme/tokens';

export default function DevicesScreen() {
  const toast = useToast((s) => s.show);
  const [devices, setDevices] = useState<PairedDevice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    setLoading(true);
    try {
      setDevices(sortDevices((await session.client.getDevices(session.creds)).devices));
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

  const remove = (d: PairedDevice) => {
    Alert.alert(`Remove ${d.name}?`, 'It stops working with Jasper right away. You can pair it again later with a new code.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const session = getSession();
          if (!session) return;
          setBusy(d.id);
          try {
            await session.client.removeDevice(d.id, session.creds);
            toast(`${d.name} removed`);
            await load();
          } catch {
            toast('Could not remove it. Try again.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <ScreenHeader title="Paired devices" />
      </View>
      {loading && !devices ? (
        <View style={styles.center}>
          <Spinner />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={theme.colors.muted} />}
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Text variant="muted">These phones and computers can reach your Jasper. Remove any you do not use or do not recognise.</Text>
          {(devices ?? []).map((d) => (
            <View key={d.id}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.name}>
                    {d.name}
                    {d.current ? '  (this phone)' : ''}
                  </Text>
                  <Text variant="muted">
                    {lastSeenText(d.last_seen)}
                    {isStale(d) ? '  ·  looks unused' : ''}
                  </Text>
                </View>
                {d.current ? null : (
                  <Button title={busy === d.id ? 'Removing...' : 'Remove'} variant="secondary" disabled={busy !== null} onPress={() => remove(d)} />
                )}
              </View>
              <Divider />
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, paddingBottom: 48, gap: 12 },
  error: { color: theme.colors.danger },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowText: { flex: 1, gap: 2 },
  name: { fontWeight: '600' },
});
