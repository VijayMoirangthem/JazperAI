/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Check, ChevronLeft, Search, SlidersHorizontal } from 'lucide-react-native';
import { CircleButton, SectionLabel, SheetScreen, Skeleton, useToast } from '@/components/ui/kit';
import { Button } from '@/components/ui';
import { PluginLogo } from '@/components/PluginLogo';
import { getSession } from '@/api/session';
import { ConnectorItem } from '@/api/types';
import { useCatalogue } from '@/store/catalogue';
import { theme } from '@/theme/tokens';

type Filter = 'all' | 'added' | 'available';

export default function PluginsSheet() {
  const router = useRouter();
  const toast = useToast((s) => s.show);
  const data = useCatalogue((s) => s.data);
  const requested = useCatalogue((s) => s.requested);
  const [loading, setLoading] = useState(!data);
  const [offline, setOffline] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [selected, setSelected] = useState<ConnectorItem | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const session = getSession();
    if (!session) return;
    try {
      const response = await session.client.getConnectors(session.creds);
      useCatalogue.getState().setData(response);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const matches = useCallback(
    (item: ConnectorItem) => {
      const q = query.trim().toLowerCase();
      if (q && !`${item.name} ${item.description} ${item.category}`.toLowerCase().includes(q)) return false;
      if (filter === 'added') return item.connected;
      if (filter === 'available') return !item.connected;
      return true;
    },
    [query, filter]
  );

  const featured = useMemo(() => (data?.featured ?? []).filter(matches), [data, matches]);
  const team = useMemo(() => (data?.team ?? []).filter(matches), [data, matches]);
  const all = useMemo(() => (data?.all ?? []).filter(matches), [data, matches]);

  const send = async () => {
    const session = getSession();
    if (!session || !selected) return;
    setSending(true);
    try {
      await session.client.requestConnector(selected.id, session.creds);
      useCatalogue.getState().markRequested(selected.id);
      toast('Sent. Finish it on your computer.');
      setSelected(null);
    } catch {
      toast("Couldn't send that. Try again.");
    } finally {
      setSending(false);
    }
  };

  const renderRow = (item: ConnectorItem) => (
    <Pressable
      key={item.id}
      onPress={() => setSelected(item)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.surface }]}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, ${item.connected ? 'added' : requested[item.id] ? 'requested' : 'not added'}. ${item.description}`}
    >
      <PluginLogo logoKey={item.logo_key} name={item.name} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.rowDesc} numberOfLines={2}>
          {item.description}
        </Text>
      </View>
      {item.connected ? (
        <View style={[styles.chip, { backgroundColor: theme.colors.successBg }]}>
          <Check size={13} color={theme.colors.success} />
          <Text style={[styles.chipText, { color: theme.colors.success }]}>Added</Text>
        </View>
      ) : (
        <View style={styles.chip}>
          <Text style={styles.chipText}>{requested[item.id] ? 'Requested' : 'Add'}</Text>
        </View>
      )}
    </Pressable>
  );

  return (
    <SheetScreen height="tall" tint={theme.colors.background}>
      {selected ? (
        <View style={styles.confirm}>
          <PluginLogo logoKey={selected.logo_key} name={selected.name} size={64} />
          <Text style={styles.confirmTitle}>{selected.name}</Text>
          <Text style={styles.confirmBody}>{selected.description || 'Connects Jasper to this tool.'}</Text>
          {selected.connected ? (
            <>
              <Text style={styles.confirmNote}>Added. It can {selected.tier_summary === 'read' ? 'read' : 'read and change'} data for you. Manage it on your computer.</Text>
              <Button title="Done" variant="secondary" onPress={() => setSelected(null)} style={styles.confirmButton} />
            </>
          ) : (
            <>
              <Text style={styles.confirmNote}>Finish connecting {selected.name} on your computer? Passwords never go through the phone.</Text>
              <Button title="Send to desktop" onPress={send} loading={sending} disabled={!!requested[selected.id]} style={styles.confirmButton} />
              <Button title="Cancel" variant="secondary" onPress={() => setSelected(null)} style={styles.confirmButton} />
            </>
          )}
        </View>
      ) : (
        <>
          <View style={styles.top}>
            <CircleButton label="Back" onPress={() => router.back()}>
              <ChevronLeft size={22} color={theme.colors.text} />
            </CircleButton>
            <Text style={styles.title} accessibilityRole="header">
              Plugins
            </Text>
          </View>
          <View style={styles.searchRow}>
            <View style={styles.search}>
              <Search size={18} color={theme.colors.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search plugins"
                placeholderTextColor={theme.colors.faint}
                style={styles.searchInput}
                accessibilityLabel="Search plugins"
                autoCorrect={false}
              />
            </View>
            <CircleButton label="Filter" onPress={() => setShowFilters((v) => !v)} tone={filter === 'all' ? 'white' : 'black'}>
              <SlidersHorizontal size={18} color={filter === 'all' ? theme.colors.text : theme.colors.pillText} />
            </CircleButton>
          </View>
          {showFilters ? (
            <View style={styles.filters}>
              {(['all', 'added', 'available'] as Filter[]).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => setFilter(f)}
                  style={[styles.filterChip, filter === f && { backgroundColor: theme.colors.pill }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f }}
                  accessibilityLabel={`Show ${f}`}
                >
                  <Text style={[styles.filterText, filter === f && { color: theme.colors.pillText }]}>{f === 'all' ? 'All' : f === 'added' ? 'Added' : 'Available'}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {offline ? <Text style={styles.offline}>Offline. Showing what was loaded last.</Text> : null}

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            {loading && !data ? (
              <View style={{ gap: 20, paddingTop: 20 }}>
                {[0, 1, 2, 3].map((i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                    <Skeleton width={44} height={44} radius={12} />
                    <View style={{ flex: 1, gap: 8 }}>
                      <Skeleton width="40%" height={14} />
                      <Skeleton width="85%" height={12} />
                    </View>
                  </View>
                ))}
              </View>
            ) : !data ? (
              <View style={styles.emptyBox}>
                <ActivityIndicator color={theme.colors.muted} />
                <Text style={styles.emptyText}>Can't reach Jasper. Pull the sheet down and try again.</Text>
              </View>
            ) : viewAll ? (
              <>
                <View style={styles.sectionHead}>
                  <SectionLabel>All plugins</SectionLabel>
                  <Text onPress={() => setViewAll(false)} style={styles.viewAll} accessibilityRole="button">
                    Back
                  </Text>
                </View>
                {all.map(renderRow)}
              </>
            ) : featured.length + team.length === 0 ? (
              <Text style={styles.emptyText}>No plugins match.</Text>
            ) : (
              <>
                {featured.length > 0 ? (
                  <>
                    <View style={styles.sectionHead}>
                      <SectionLabel>Featured</SectionLabel>
                      <Text onPress={() => setViewAll(true)} style={styles.viewAll} accessibilityRole="button" accessibilityLabel="View all featured">
                        View all
                      </Text>
                    </View>
                    {featured.map(renderRow)}
                  </>
                ) : null}
                {team.length > 0 ? (
                  <>
                    <View style={[styles.sectionHead, { marginTop: 18 }]}>
                      <SectionLabel>Team plugins</SectionLabel>
                      <Text onPress={() => setViewAll(true)} style={styles.viewAll} accessibilityRole="button" accessibilityLabel="View all team plugins">
                        View all
                      </Text>
                    </View>
                    {team.map(renderRow)}
                  </>
                ) : null}
              </>
            )}
          </ScrollView>
        </>
      )}
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  title: { fontSize: theme.fontSizes.lg, fontWeight: '600', color: theme.colors.text },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderRadius: 23, backgroundColor: theme.colors.circle, paddingHorizontal: 14, ...theme.shadows.circle },
  searchInput: { flex: 1, fontSize: theme.fontSizes.body, color: theme.colors.text, padding: 0 },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16, backgroundColor: theme.colors.chipBg },
  filterText: { fontSize: theme.fontSizes.sm, fontWeight: '600', color: theme.colors.text },
  offline: { fontSize: theme.fontSizes.sm, color: theme.colors.warning, paddingVertical: 4 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  viewAll: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 14 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: theme.fontSizes.body, fontWeight: '600', color: theme.colors.text },
  rowDesc: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: theme.colors.chipBg },
  chipText: { fontSize: theme.fontSizes.sm, fontWeight: '600', color: theme.colors.text },
  emptyBox: { alignItems: 'center', gap: 12, paddingTop: 40 },
  emptyText: { textAlign: 'center', color: theme.colors.muted, paddingTop: 30, fontSize: theme.fontSizes.base },
  confirm: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  confirmTitle: { fontSize: theme.fontSizes.xl, fontWeight: '600', color: theme.colors.text },
  confirmBody: { textAlign: 'center', color: theme.colors.muted, fontSize: theme.fontSizes.base },
  confirmNote: { textAlign: 'center', color: theme.colors.text, fontSize: theme.fontSizes.base, marginTop: 6 },
  confirmButton: { alignSelf: 'stretch', height: 50 },
});
