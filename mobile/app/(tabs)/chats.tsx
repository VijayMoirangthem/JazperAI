import React, { useCallback, useEffect, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Href, useFocusEffect, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Plus, Search, User } from 'lucide-react-native';
import { Bot, BotGroup } from '@/api/types';
import { getSession } from '@/api/session';
import { useAuth } from '@/auth/useAuth';
import { useBots } from '@/store/bots';
import { useChat } from '@/store/chat';
import { useHome } from '@/store/home';
import { useApprovals } from '@/store/approvals';
import { useMascotLooks } from '@/store/mascot';
import { useSettings } from '@/store/settings';
import { BotMeta } from '@/db/meta';
import { MascotWithBadges } from '@/components/MascotExtras';
import { CircleButton, SectionLabel, Skeleton, UnreadDot } from '@/components/ui/kit';
import { EmptyState } from '@/components/ui';
import { colorHex } from '@/utils/mascot';
import { conversationPreview, initialsOf, listTime } from '@/utils/format';
import { MascotBodyId } from '@/mascot/bodies';
import { theme } from '@/theme/tokens';

type Item = { type: 'section'; id: string; label: string } | { type: 'bot'; bot: Bot };

function byRecent(meta: Record<string, BotMeta>) {
  return (a: Bot, b: Bot) => (meta[b.slug]?.lastAt ?? 0) - (meta[a.slug]?.lastAt ?? 0);
}

function buildItems(groups: BotGroup[], meta: Record<string, BotMeta>): Item[] {
  const items: Item[] = [];
  for (const group of groups) {
    const bots = group.bots.filter((bot) => bot.enabled);
    if (bots.length === 0) continue;
    items.push({ type: 'section', id: group.id, label: group.label });
    for (const bot of [...bots].sort(byRecent(meta))) items.push({ type: 'bot', bot });
  }
  return items;
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const credentials = useAuth((s) => s.credentials);
  const { groups, loading, error, loadBots } = useBots();
  const meta = useHome((s) => s.meta);
  const refreshMeta = useHome((s) => s.refresh);
  const messagesByBot = useChat((s) => s.messagesByBot);
  const streamingByBot = useChat((s) => s.streamingByBot);
  const pending = useApprovals((s) => s.requests);
  const profileName = useSettings((s) => s.profileName);
  const setLook = useMascotLooks((s) => s.setLook);

  const load = useCallback(async () => {
    const session = getSession();
    if (session) await loadBots(session.client);
  }, [loadBots]);

  useEffect(() => {
    if (credentials) void load();
  }, [credentials, load]);

  useFocusEffect(
    useCallback(() => {
      refreshMeta();
    }, [refreshMeta])
  );

  // Messages arriving in the background change previews and unread dots.
  useEffect(() => {
    const id = setTimeout(refreshMeta, 250);
    return () => clearTimeout(id);
  }, [messagesByBot, refreshMeta]);

  // Looks chosen on the desktop or another phone arrive with the bot list.
  useEffect(() => {
    for (const group of groups) {
      for (const bot of group.bots) {
        if (bot.look?.body && bot.look.color) {
          setLook(bot.slug, { body: bot.look.body as MascotBodyId, color: colorHex(bot.look.color) });
        }
      }
    }
  }, [groups, setLook]);

  const items = useMemo(() => buildItems(groups, meta), [groups, meta]);
  const allBots = useMemo(() => groups.flatMap((g) => g.bots.filter((b) => b.enabled)), [groups]);
  const pinned = useMemo(() => allBots.filter((b) => meta[b.slug]?.pinned), [allBots, meta]);
  const attention = useMemo(() => new Set(pending.map((r) => r.requester)), [pending]);

  const open = useCallback((slug: string) => router.push(`/chat/${slug}` as Href), [router]);
  const menu = useCallback((slug: string) => router.push(`/menu?slug=${encodeURIComponent(slug)}` as Href), [router]);

  const header = (
    <View>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <CircleButton label="Profile and settings" onPress={() => router.push('/profile' as Href)}>
          {profileName ? <Text style={styles.initials}>{initialsOf(profileName)}</Text> : <User size={20} color={theme.colors.text} />}
        </CircleButton>
        <View style={styles.headerRight}>
          {pending.length > 0 ? (
            <Pressable
              onPress={() => router.push('/(tabs)/approvals' as Href)}
              style={styles.attention}
              accessibilityRole="button"
              accessibilityLabel={`${pending.length} approvals waiting`}
            >
              <View style={styles.attentionDot} />
              <Text style={styles.attentionText}>{pending.length} to approve</Text>
            </Pressable>
          ) : null}
          <CircleButton label="Search" onPress={() => router.push('/search' as Href)}>
            <Search size={20} color={theme.colors.text} />
          </CircleButton>
          <CircleButton label="Create a bot" onPress={() => router.push('/create-bot' as Href)}>
            <Plus size={22} color={theme.colors.text} />
          </CircleButton>
        </View>
      </View>

      {pinned.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pinnedRow}
          decelerationRate="fast"
          snapToInterval={104}
          accessibilityLabel="Pinned bots"
        >
          {pinned.map((bot, index) => (
            <Pressable
              key={bot.slug}
              onPress={() => open(bot.slug)}
              onLongPress={() => menu(bot.slug)}
              style={styles.pinned}
              accessibilityRole="button"
              accessibilityLabel={`Chat with ${bot.display_name}`}
            >
              <MascotWithBadges
                slug={bot.slug}
                size={92}
                animated={index < 4}
                star={index === 0}
                attention={attention.has(bot.slug) || !!streamingByBot[bot.slug]}
              />
              <Text style={styles.pinnedName} numberOfLines={1}>
                {bot.display_name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );

  if (loading && groups.length === 0) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.skeletons}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <View key={i} style={styles.skeletonRow}>
              <Skeleton width={48} height={48} radius={24} />
              <View style={{ flex: 1, gap: 8 }}>
                <Skeleton width="45%" height={14} />
                <Skeleton width="80%" height={12} />
              </View>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <FlashList
        data={items}
        keyExtractor={(item) => (item.type === 'section' ? `s-${item.id}` : item.bot.slug)}
        getItemType={(item) => item.type}
        ListHeaderComponent={header}
        refreshing={loading}
        onRefresh={load}
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <EmptyState
              title={error ? "Can't reach Jasper" : 'No bots yet'}
              subtitle={error ? 'Pull down to try again.' : 'Create your first bot.'}
              actionLabel={error ? 'Retry' : 'Create a bot'}
              onAction={error ? load : () => router.push('/create-bot' as Href)}
            />
          </View>
        }
        renderItem={({ item }) =>
          item.type === 'section' ? (
            <SectionLabel style={styles.section}>{item.label}</SectionLabel>
          ) : (
            <BotRow
              bot={item.bot}
              meta={meta[item.bot.slug]}
              streaming={!!streamingByBot[item.bot.slug]}
              needsApproval={attention.has(item.bot.slug)}
              onPress={open}
              onLongPress={menu}
            />
          )
        }
      />
    </View>
  );
}

interface RowProps {
  bot: Bot;
  meta?: BotMeta;
  streaming: boolean;
  needsApproval: boolean;
  onPress: (slug: string) => void;
  onLongPress: (slug: string) => void;
}

const BotRow = React.memo(function BotRow({ bot, meta, streaming, needsApproval, onPress, onLongPress }: RowProps) {
  const chip = bot.position || bot.department;
  const preview = needsApproval
    ? 'Needs your approval'
    : streaming
      ? 'Working…'
      : meta?.lastPreview
        ? conversationPreview(meta.lastRole, meta.lastPreview)
        : '';
  const unread = !!meta?.unread && !meta.muted;
  return (
    <Pressable
      onPress={() => onPress(bot.slug)}
      onLongPress={() => onLongPress(bot.slug)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`${bot.display_name}${chip ? `, ${chip}` : ''}${unread ? ', unread' : ''}. ${preview}`}
      accessibilityHint="Opens the chat. Long press for more."
    >
      <MascotWithBadges slug={bot.slug} size={48} attention={needsApproval} />
      <View style={styles.rowBody}>
        <View style={styles.nameLine}>
          <Text style={styles.name} numberOfLines={1}>
            {bot.display_name}
          </Text>
          {chip ? (
            <View style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>
                {chip}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
          {preview || ' '}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.time}>{meta?.lastAt ? listTime(meta.lastAt) : ''}</Text>
        <View style={styles.dotSlot}>{unread ? <UnreadDot /> : null}</View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  initials: { fontSize: theme.fontSizes.sm, fontWeight: '600', color: theme.colors.muted },
  attention: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: theme.colors.warningBg,
  },
  attentionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.warning },
  attentionText: { fontSize: theme.fontSizes.sm, fontWeight: '600', color: theme.colors.warning },
  pinnedRow: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 14, gap: 12 },
  pinned: { width: 92, alignItems: 'center', gap: 8 },
  pinnedName: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, maxWidth: 92 },
  section: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 76, marginHorizontal: 8, paddingHorizontal: 12, borderRadius: 18 },
  rowPressed: { backgroundColor: theme.colors.chipBg },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 0, maxWidth: '62%', fontSize: theme.fontSizes.lg, fontWeight: '600', color: theme.colors.text },
  chip: { flexShrink: 1, minWidth: 0, backgroundColor: theme.colors.chipBg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { fontSize: 12, color: theme.colors.chipText },
  preview: { fontSize: theme.fontSizes.base, color: theme.colors.muted },
  previewUnread: { color: theme.colors.text },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center', gap: 6, minWidth: 58 },
  time: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  dotSlot: { height: 10 },
  skeletons: { paddingHorizontal: 20, gap: 22, paddingTop: 12 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  empty: { paddingTop: 60 },
});
