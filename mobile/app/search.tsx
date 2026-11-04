/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Clock, Search as SearchIcon, X } from 'lucide-react-native';
import { Bot } from '@/api/types';
import { useBots } from '@/store/bots';
import { useCatalogue } from '@/store/catalogue';
import { SearchHit, addRecentSearch, clearRecentSearches, listRecentSearches, searchMessages } from '@/db/meta';
import { Mascot } from '@/components/Mascot';
import { PluginLogo } from '@/components/PluginLogo';
import { SectionLabel } from '@/components/ui/kit';
import { clockTime, listTime, plainPreview } from '@/utils/format';
import { theme } from '@/theme/tokens';

type Row =
  | { type: 'label'; key: string; text: string }
  | { type: 'bot'; key: string; bot: Bot }
  | { type: 'message'; key: string; hit: SearchHit; name: string }
  | { type: 'plugin'; key: string; id: string; name: string; logo: string; description: string };

/** Short text around the first match, with the match returned separately so it can be bold. */
export function snippet(text: string, query: string): { before: string; match: string; after: string } {
  const plain = plainPreview(text);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lower = plain.toLowerCase();
  let index = -1;
  let length = 0;
  for (const word of words) {
    const at = lower.indexOf(word);
    if (at >= 0 && (index < 0 || at < index)) {
      index = at;
      length = word.length;
    }
  }
  if (index < 0) return { before: plain.slice(0, 90), match: '', after: '' };
  const start = Math.max(0, index - 36);
  return {
    before: (start > 0 ? '…' : '') + plain.slice(start, index),
    match: plain.slice(index, index + length),
    after: plain.slice(index + length, index + length + 70),
  };
}

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ q?: string }>();
  const groups = useBots((s) => s.groups);
  const catalogue = useCatalogue((s) => s.data);
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const [debounced, setDebounced] = useState(query);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    setRecents(listRecentSearches());
  }, []);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(id);
  }, [query]);

  const bots = useMemo(() => groups.flatMap((g) => g.bots.filter((b) => b.enabled)), [groups]);
  const nameOf = useCallback((slug: string) => bots.find((b) => b.slug === slug)?.display_name ?? slug, [bots]);

  const rows = useMemo<Row[]>(() => {
    const q = debounced.trim().toLowerCase();
    if (q.length < 1) return [];
    const out: Row[] = [];
    const matchedBots = bots.filter((b) => `${b.display_name} ${b.position} ${b.department} ${b.slug}`.toLowerCase().includes(q)).slice(0, 6);
    if (matchedBots.length) {
      out.push({ type: 'label', key: 'l-bots', text: 'Bots' });
      for (const bot of matchedBots) out.push({ type: 'bot', key: `b-${bot.slug}`, bot });
    }
    let hits: SearchHit[] = [];
    try {
      hits = q.length > 1 ? searchMessages(debounced, 30) : [];
    } catch {
      hits = [];
    }
    if (hits.length) {
      out.push({ type: 'label', key: 'l-msg', text: 'Messages' });
      for (const hit of hits) out.push({ type: 'message', key: `m-${hit.id}`, hit, name: nameOf(hit.bot_slug) });
    }
    const plugins = (catalogue?.all ?? []).filter((c) => `${c.name} ${c.description}`.toLowerCase().includes(q)).slice(0, 5);
    if (plugins.length) {
      out.push({ type: 'label', key: 'l-plug', text: 'Plugins' });
      for (const plugin of plugins) out.push({ type: 'plugin', key: `p-${plugin.id}`, id: plugin.id, name: plugin.name, logo: plugin.logo_key, description: plugin.description });
    }
    return out;
  }, [debounced, bots, catalogue, nameOf]);

  const remember = () => {
    addRecentSearch(query);
    setRecents(listRecentSearches());
  };

  const openBot = (slug: string) => {
    remember();
    router.push(`/chat/${slug}` as Href);
  };

  const renderRow = ({ item }: { item: Row }) => {
    if (item.type === 'label') return <SectionLabel style={styles.label}>{item.text}</SectionLabel>;
    if (item.type === 'bot') {
      return (
        <Pressable onPress={() => openBot(item.bot.slug)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Open ${item.bot.display_name}`}>
          <Mascot slug={item.bot.slug} size={42} animated={false} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.bot.display_name}</Text>
            {item.bot.position ? <Text style={styles.sub}>{item.bot.position}</Text> : null}
          </View>
        </Pressable>
      );
    }
    if (item.type === 'message') {
      const s = snippet(item.hit.text, debounced);
      return (
        <Pressable
          onPress={() => {
            remember();
            router.push(`/chat/${item.hit.bot_slug}?m=${item.hit.id}` as Href);
          }}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Message in ${item.name}`}
        >
          <Mascot slug={item.hit.bot_slug} size={42} animated={false} />
          <View style={{ flex: 1 }}>
            <View style={styles.msgHead}>
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.time}>{listTime(item.hit.ts) === clockTime(item.hit.ts) ? clockTime(item.hit.ts) : listTime(item.hit.ts)}</Text>
            </View>
            <Text style={styles.snippet} numberOfLines={2}>
              {s.before}
              {s.match ? <Text style={styles.match}>{s.match}</Text> : null}
              {s.after}
            </Text>
          </View>
        </Pressable>
      );
    }
    return (
      <Pressable onPress={() => router.push('/plugins' as Href)} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`Plugin ${item.name}`}>
        <PluginLogo logoKey={item.logo} name={item.name} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {item.description}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
      <View style={styles.bar}>
        <View style={styles.field}>
          <SearchIcon size={18} color={theme.colors.faint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={theme.colors.faint}
            autoFocus
            style={styles.input}
            returnKeyType="search"
            onSubmitEditing={remember}
            accessibilityLabel="Search"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
              <X size={18} color={theme.colors.muted} />
            </Pressable>
          ) : null}
        </View>
        <Text
          onPress={() => {
            Keyboard.dismiss();
            router.back();
          }}
          style={styles.cancel}
          accessibilityRole="button"
        >
          Cancel
        </Text>
      </View>

      {debounced.trim().length < 1 ? (
        <View style={{ paddingHorizontal: 20 }}>
          {recents.length > 0 ? (
            <>
              <View style={styles.recentHead}>
                <SectionLabel>Recent</SectionLabel>
                <Text
                  onPress={() => {
                    clearRecentSearches();
                    setRecents([]);
                  }}
                  style={styles.clear}
                  accessibilityRole="button"
                >
                  Clear
                </Text>
              </View>
              {recents.map((r) => (
                <Pressable key={r} onPress={() => setQuery(r)} style={styles.recent} accessibilityRole="button" accessibilityLabel={`Search ${r}`}>
                  <Clock size={16} color={theme.colors.faint} />
                  <Text style={styles.recentText}>{r}</Text>
                </Pressable>
              ))}
            </>
          ) : (
            <Text style={styles.hint}>Search bots, messages and plugins.</Text>
          )}
        </View>
      ) : rows.length === 0 ? (
        <Text style={styles.hint}>Nothing found for “{debounced}”.</Text>
      ) : (
        <FlatList data={rows} keyExtractor={(r) => r.key} renderItem={renderRow} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  field: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, borderRadius: 23, backgroundColor: theme.colors.chipBg, paddingHorizontal: 14 },
  input: { flex: 1, fontSize: theme.fontSizes.body, color: theme.colors.text, padding: 0 },
  cancel: { fontSize: theme.fontSizes.body, color: theme.colors.text, fontWeight: '500' },
  label: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10 },
  pressed: { backgroundColor: theme.colors.surface },
  name: { fontSize: theme.fontSizes.lg, fontWeight: '600', color: theme.colors.text, flexShrink: 1 },
  sub: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 2 },
  msgHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  time: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  snippet: { fontSize: theme.fontSizes.base, color: theme.colors.muted, marginTop: 2 },
  match: { fontWeight: '700', color: theme.colors.text },
  hint: { textAlign: 'center', color: theme.colors.muted, paddingTop: 60, fontSize: theme.fontSizes.base },
  recentHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 },
  clear: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  recent: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44 },
  recentText: { fontSize: theme.fontSizes.body, color: theme.colors.text },
});
