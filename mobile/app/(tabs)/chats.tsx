import { View, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import React, { useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useBots } from '@/store/bots';
import { useAuth } from '@/auth/useAuth';
import { JasperClient } from '@/api/client';
import { Bot, BotGroup } from '@/api/types';
import {
  Screen,
  Text,
  Card,
  Divider,
  Badge,
  EmptyState,
  Spinner,
} from '@/components/ui';
import { Mascot } from '@/components/Mascot';

interface BotsSection {
  id: string;
  label: string;
  bots: Bot[];
}

type ListItem = 
  | { type: 'section'; section: BotsSection }
  | { type: 'bot'; bot: Bot };

function buildSectionedBots(groups: BotGroup[], search: string): ListItem[] {
  const searchLower = search.toLowerCase();

  if (!search) {
    const items: ListItem[] = [];
    for (const group of groups) {
      items.push({ type: 'section', section: { id: group.id, label: group.label, bots: group.bots } });
      for (const bot of group.bots) {
        items.push({ type: 'bot', bot });
      }
    }
    return items;
  }

  const filteredGroups = groups
    .map((group: BotGroup) => ({
      ...group,
      bots: group.bots.filter(
        (bot: Bot) =>
          bot.display_name.toLowerCase().includes(searchLower) ||
          bot.position.toLowerCase().includes(searchLower) ||
          bot.department.toLowerCase().includes(searchLower) ||
          bot.slug.toLowerCase().includes(searchLower)
      ),
    }))
    .filter((group: BotsSection) => group.bots.length > 0);

  const items: ListItem[] = [];
  for (const group of filteredGroups) {
    items.push({ type: 'section', section: { id: group.id, label: group.label, bots: group.bots } });
    for (const bot of group.bots) {
      items.push({ type: 'bot', bot });
    }
  }
  return items;
}

export default function ChatsScreen() {
  const router = useRouter();
  const { deviceId, deviceSecret } = useAuth();
  const { groups, loading, error, loadBots, setSearch, clearError, search } = useBots();

  const clientRef = useRef<JasperClient | null>(null);

  // Initialize client in useEffect to avoid ref access during render
  useEffect(() => {
    const credentials = useAuth.getState().credentials;
    if (credentials && !clientRef.current) {
      clientRef.current = new JasperClient(credentials.baseUrl);
    }
  }, []);

  const load = useCallback(async () => {
    if (clientRef.current && deviceId && deviceSecret) {
      await loadBots(clientRef.current);
    }
  }, [loadBots, deviceId, deviceSecret]);

  useEffect(() => {
    load();
  }, [load]);

  const items = useMemo(() => buildSectionedBots(groups, search), [groups, search]);

  if (loading && groups.length === 0) {
    return (
      <Screen>
        <View style={styles.loadingContainer}>
          <Spinner size="large" />
        </View>
      </Screen>
    );
  }

  if (error && groups.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="Unable to load bots"
          subtitle={error}
          actionLabel="Retry"
          onAction={load}
        />
      </Screen>
    );
  }

  if (items.length === 0) {
    return (
      <Screen>
        <EmptyState
          title="No bots found"
          subtitle={search ? 'Try a different search term' : 'No bots are available'}
          actionLabel={search ? 'Clear search' : undefined}
          onAction={search ? () => setSearch('') : undefined}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.searchContainer}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search bots..."
          style={styles.searchInput}
          placeholderTextColor="rgba(255,255,255,0.3)"
        />
      </View>

      <FlashList
        data={items}
        renderItem={({ item }) => {
          if (item.type === 'section') {
            return (
              <View style={styles.sectionHeader}>
                <Text variant="caption" style={styles.sectionTitle}>
                  {item.section.label.toUpperCase()} ({item.section.bots.length})
                </Text>
              </View>
            );
          }
          return (
            <BotRow
              bot={item.bot}
              router={router}
              onPress={() => router.push(`/chat/${item.bot.slug}` as any)}
              onLongPress={() => router.push(`/bot/${item.bot.slug}` as any)}
            />
          );
        }}
        keyExtractor={(item) => (item.type === 'section' ? `section-${item.section.id}` : item.bot.slug)}
        onRefresh={async () => {
          clearError();
          const client = clientRef.current;
          if (client) await loadBots(client);
        }}
        refreshing={loading}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <Divider style={styles.itemDivider} />}
        ListHeaderComponent={() => <View style={{ height: 8 }} />}
        ListFooterComponent={() => <View style={{ height: 24 }} />}
      />
    </Screen>
  );
}

function BotRow({ bot, router, onPress, onLongPress }: { bot: import('@/api/types').Bot; router: ReturnType<typeof useRouter>; onPress: () => void; onLongPress: () => void }) {
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/chat/${bot.slug}` as any)}
      onLongPress={() => router.push(`/bot/${bot.slug}` as any)}
      activeOpacity={0.8}
    >
      <Mascot slug={bot.slug} size={36} animated={false} />
      <TouchableOpacity style={styles.content} activeOpacity={1}>
        <Text variant="body" style={styles.name} numberOfLines={1}>
          {bot.display_name}
        </Text>
        <Text variant="caption" style={styles.position} numberOfLines={1}>
          {bot.position}
        </Text>
      </TouchableOpacity>
      <Badge score={bot.score} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    padding: 16,
    paddingBottom: 8,
  },
  searchInput: {
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#f2f2f2',
    fontSize: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 8,
  },
  itemDivider: {
    marginHorizontal: 16,
  },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0b0b0b',
  },
  sectionTitle: {
    opacity: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#161616',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    marginBottom: 2,
  },
  position: {
    opacity: 0.55,
    fontSize: 12,
  },
});