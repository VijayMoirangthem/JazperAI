import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Bell, BellOff, CheckCheck, Circle, Pin, PinOff, Trash2, User } from 'lucide-react-native';
import { SheetScreen } from '@/components/ui/kit';
import { SheetRow } from '@/components/ui/SheetRow';
import { Mascot } from '@/components/Mascot';
import { useBots } from '@/store/bots';
import { useHome } from '@/store/home';
import { useChat } from '@/store/chat';
import { clearMessages } from '@/db/chat';
import { theme } from '@/theme/tokens';

/** Long-press menu for a bot on Home. */
export default function BotMenu() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const botSlug = typeof slug === 'string' ? slug : '';
  const groups = useBots((s) => s.groups);
  const meta = useHome((s) => s.meta[botSlug]);
  const { togglePin, toggleMute, markRead, markUnread } = useHome.getState();
  const bot = groups.flatMap((g) => g.bots).find((b) => b.slug === botSlug);
  const color = theme.colors.text;

  const done = (action: () => void) => () => {
    action();
    router.back();
  };

  return (
    <SheetScreen>
      <View style={styles.head}>
        <Mascot slug={botSlug} size={44} animated={false} />
        <Text style={styles.name} numberOfLines={1}>
          {bot?.display_name ?? botSlug}
        </Text>
      </View>
      <SheetRow
        label={meta?.pinned ? 'Unpin' : 'Pin to top'}
        icon={meta?.pinned ? <PinOff size={20} color={color} /> : <Pin size={20} color={color} />}
        onPress={done(() => togglePin(botSlug))}
      />
      <SheetRow
        label={meta?.unread ? 'Mark as read' : 'Mark as unread'}
        icon={meta?.unread ? <CheckCheck size={20} color={color} /> : <Circle size={20} color={color} />}
        onPress={done(() => (meta?.unread ? markRead(botSlug) : markUnread(botSlug)))}
      />
      <SheetRow
        label={meta?.muted ? 'Unmute' : 'Mute'}
        icon={meta?.muted ? <Bell size={20} color={color} /> : <BellOff size={20} color={color} />}
        onPress={done(() => toggleMute(botSlug))}
      />
      <SheetRow
        label="View profile"
        icon={<User size={20} color={color} />}
        onPress={() => {
          router.back();
          setTimeout(() => router.push(`/bot/${botSlug}` as Href), 200);
        }}
      />
      <SheetRow
        label="Clear chat on this phone"
        danger
        icon={<Trash2 size={20} color={theme.colors.danger} />}
        onPress={done(() => {
          clearMessages(botSlug);
          useChat.getState().loadMessages(botSlug, 50);
          useHome.getState().refresh();
        })}
      />
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 8 },
  name: { flex: 1, fontSize: theme.fontSizes.xl, fontWeight: '600', color: theme.colors.text },
});
