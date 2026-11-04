import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BellOff, ChevronLeft, MessageCircle, Pencil, Pin, PinOff, Puzzle } from 'lucide-react-native';
import { BotCardResponse } from '@/api/types';
import { getSession } from '@/api/session';
import { useBots } from '@/store/bots';
import { useHome } from '@/store/home';
import { useChat } from '@/store/chat';
import { useMascotLooks, lookFor } from '@/store/mascot';
import { clearMessages } from '@/db/chat';
import { Mascot } from '@/components/Mascot';
import { LookPicker } from '@/components/LookPicker';
import { Badge } from '@/components/ui';
import { CircleButton, SectionLabel, Skeleton, useToast } from '@/components/ui/kit';
import { MascotBodyId } from '@/mascot/bodies';
import { MascotPaletteName, colorHex, colorName } from '@/utils/mascot';
import { MASCOT_PALETTE, theme } from '@/theme/tokens';
import { listTime } from '@/utils/format';

const cardCache: Record<string, BotCardResponse> = {};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <SectionLabel style={{ marginBottom: 10 }}>{title}</SectionLabel>
      {children}
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineValue} numberOfLines={1}>
        {value || '-'}
      </Text>
    </View>
  );
}

export default function BotProfile() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const botSlug = typeof slug === 'string' ? slug : '';
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const groups = useBots((s) => s.groups);
  const meta = useHome((s) => s.meta[botSlug]);
  const savedLook = useMascotLooks((s) => s.looks[botSlug]);
  const look = React.useMemo(() => lookFor(savedLook ? { [botSlug]: savedLook } : {}, botSlug), [savedLook, botSlug]);
  const setLook = useMascotLooks((s) => s.setLook);
  const bot = groups.flatMap((g) => g.bots).find((b) => b.slug === botSlug);
  const [card, setCard] = useState<BotCardResponse | null>(cardCache[botSlug] ?? null);
  const [offline, setOffline] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(bot?.display_name ?? '');
  const [editLook, setEditLook] = useState(false);

  useEffect(() => {
    const session = getSession();
    if (!session || !botSlug) return;
    session.client
      .getBotCard(botSlug, session.creds)
      .then((response) => {
        cardCache[botSlug] = response;
        setCard(response);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, [botSlug]);

  const displayName = card?.display_name ?? bot?.display_name ?? botSlug;
  const phoneMade = card?.group === 'mobile' || card?.group_label?.toLowerCase() === 'mobile';
  const editable = botSlug !== 'jasper';

  const saveName = useCallback(async () => {
    const session = getSession();
    const next = name.trim();
    setEditing(false);
    if (!session || next.length < 2 || next === displayName) return;
    try {
      await session.client.patchBot(botSlug, { display_name: next }, session.creds);
      setCard((c) => (c ? { ...c, display_name: next } : c));
      await useBots.getState().loadBots(session.client);
      toast('Renamed');
    } catch {
      toast("Couldn't rename. This bot may be managed on the computer.");
    }
  }, [botSlug, displayName, name, toast]);

  const changeLook = async (next: { body: MascotBodyId; colorKey: MascotPaletteName }) => {
    setLook(botSlug, { body: next.body, color: colorHex(next.colorKey) });
    const session = getSession();
    if (!session) return;
    try {
      await session.client.putLook(botSlug, { body: next.body, color: next.colorKey }, session.creds);
    } catch {
      toast('Saved on this phone only.');
    }
  };

  const archive = () => {
    Alert.alert(`Archive ${displayName}?`, 'It disappears from your list. You can bring it back on the computer.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: async () => {
          const session = getSession();
          if (!session) return;
          try {
            await session.client.archiveBot(botSlug, session.creds);
            await useBots.getState().loadBots(session.client);
            router.dismissAll();
          } catch {
            toast("Couldn't archive this bot.");
          }
        },
      },
    ]);
  };

  const stats = card
    ? [
        ['Messages answered', String(card.calls)],
        ['Thumbs up', String(card.thumbs_up)],
        ['Thumbs down', String(card.thumbs_down)],
        ['Average reply', card.avg_latency_ms ? `${(card.avg_latency_ms / 1000).toFixed(1)} s` : '-'],
        ['Last active', card.last_active_at ? listTime(new Date(card.last_active_at).getTime()) : '-'],
      ]
    : [];

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 64, paddingBottom: insets.bottom + 40, paddingHorizontal: 16, gap: 14 }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Mascot slug={botSlug} size={124} animated />
          {editing ? (
            <TextInput
              value={name}
              onChangeText={setName}
              onBlur={saveName}
              onSubmitEditing={saveName}
              autoFocus
              maxLength={40}
              style={styles.nameInput}
              accessibilityLabel="Bot name"
              returnKeyType="done"
            />
          ) : (
            <View style={styles.nameRow}>
              <Text style={styles.name} accessibilityRole="header">
                {displayName}
              </Text>
              {editable ? (
                <Pressable onPress={() => { setName(displayName); setEditing(true); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Rename">
                  <Pencil size={16} color={theme.colors.muted} />
                </Pressable>
              ) : null}
            </View>
          )}
          {card?.role_title || bot?.position ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{card?.role_title || bot?.position}</Text>
            </View>
          ) : null}
          <View style={styles.actions}>
            <Pressable onPress={() => router.replace(`/chat/${botSlug}` as Href)} style={[styles.action, { backgroundColor: theme.colors.pill }]} accessibilityRole="button" accessibilityLabel="Message">
              <MessageCircle size={18} color={theme.colors.pillText} />
              <Text style={[styles.actionText, { color: theme.colors.pillText }]}>Message</Text>
            </Pressable>
            <Pressable onPress={() => useHome.getState().togglePin(botSlug)} style={styles.action} accessibilityRole="button" accessibilityLabel={meta?.pinned ? 'Unpin' : 'Pin'}>
              {meta?.pinned ? <PinOff size={18} color={theme.colors.text} /> : <Pin size={18} color={theme.colors.text} />}
              <Text style={styles.actionText}>{meta?.pinned ? 'Unpin' : 'Pin'}</Text>
            </Pressable>
            <Pressable onPress={() => useHome.getState().toggleMute(botSlug)} style={styles.action} accessibilityRole="button" accessibilityLabel={meta?.muted ? 'Unmute' : 'Mute'}>
              <BellOff size={18} color={theme.colors.text} />
              <Text style={styles.actionText}>{meta?.muted ? 'Unmute' : 'Mute'}</Text>
            </Pressable>
          </View>
          {offline ? <Text style={styles.offline}>Offline. Showing what was saved.</Text> : null}
        </View>

        <Card title="About">
          {card ? (
            <>
              <Line label="Role" value={card.role_title || card.position} />
              <Line label="Group" value={card.group_label} />
              <Line label="Reports to" value={card.reports_to} />
              <Line label="Created" value={card.created_at ? new Date(card.created_at).toLocaleDateString() : ''} />
              <Line label="Status" value={card.enabled ? 'Active' : 'Off'} />
            </>
          ) : (
            <Skeleton width="70%" height={14} />
          )}
        </Card>

        <Card title="Look">
          {editLook ? (
            <LookPicker body={look.body} colorKey={colorName(look.color)} onChange={changeLook} />
          ) : (
            <Pressable onPress={() => setEditLook(true)} style={styles.lookRow} accessibilityRole="button" accessibilityLabel="Change look">
              <View style={[styles.swatch, { backgroundColor: look.color || MASCOT_PALETTE.blue }]} />
              <Text style={styles.lineValue}>Change shape and colour</Text>
            </Pressable>
          )}
        </Card>

        <Card title="Activity">
          {card ? (
            <>
              <View style={styles.scoreRow}>
                <Text style={styles.lineLabel}>Score</Text>
                <Badge score={card.score} />
              </View>
              {stats.map(([label, value]) => (
                <Line key={label} label={label} value={value} />
              ))}
            </>
          ) : (
            <Skeleton width="60%" height={14} />
          )}
        </Card>

        <Card title="Tools it can use">
          {card && card.tools.length > 0 ? (
            <View style={styles.tools}>
              {card.tools.map((tool) => (
                <View key={tool} style={styles.toolChip}>
                  <Text style={styles.chipText}>{tool}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.lineLabel}>{card ? 'No tools. It only chats.' : ' '}</Text>
          )}
        </Card>

        <Card title="Plugins">
          <Pressable onPress={() => router.push('/plugins' as Href)} style={styles.lookRow} accessibilityRole="button" accessibilityLabel="Open plugins">
            <Puzzle size={18} color={theme.colors.text} />
            <Text style={styles.lineValue}>See connected plugins</Text>
          </Pressable>
        </Card>

        <Card title="Chat">
          <Pressable
            onPress={() => {
              clearMessages(botSlug);
              useChat.getState().loadMessages(botSlug, 50);
              useHome.getState().refresh();
              toast('Chat cleared on this phone');
            }}
            accessibilityRole="button"
            accessibilityLabel="Clear chat on this phone"
          >
            <Text style={styles.danger}>Clear chat on this phone</Text>
          </Pressable>
          {phoneMade ? (
            <Pressable onPress={archive} accessibilityRole="button" accessibilityLabel="Archive bot" style={{ marginTop: 14 }}>
              <Text style={styles.danger}>Archive this bot</Text>
            </Pressable>
          ) : null}
        </Card>
      </ScrollView>

      <View style={[styles.back, { top: insets.top + 8 }]}>
        <CircleButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={22} color={theme.colors.text} />
        </CircleButton>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  back: { position: 'absolute', left: 14 },
  hero: { alignItems: 'center', gap: 10, paddingBottom: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  name: { fontSize: theme.fontSizes.title + 2, fontWeight: '600', color: theme.colors.text },
  nameInput: { fontSize: theme.fontSizes.title, fontWeight: '600', color: theme.colors.text, textAlign: 'center', minWidth: 160, borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingVertical: 2 },
  chip: { backgroundColor: theme.colors.chipBg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: theme.fontSizes.sm, color: theme.colors.chipText },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, paddingHorizontal: 16, borderRadius: 22, backgroundColor: theme.colors.pillSecondary },
  actionText: { fontSize: theme.fontSizes.base, fontWeight: '600', color: theme.colors.text },
  offline: { fontSize: theme.fontSizes.sm, color: theme.colors.warning },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radii.card + 4, padding: 16 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 6 },
  lineLabel: { fontSize: theme.fontSizes.base, color: theme.colors.muted },
  lineValue: { fontSize: theme.fontSizes.base, color: theme.colors.text, flexShrink: 1, textAlign: 'right' },
  lookRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 36 },
  swatch: { width: 26, height: 26, borderRadius: 13 },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  tools: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toolChip: { backgroundColor: theme.colors.chipBg, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  danger: { fontSize: theme.fontSizes.body, color: theme.colors.danger, fontWeight: '500' },
});
