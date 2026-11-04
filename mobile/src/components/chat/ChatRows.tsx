/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { FileText, Image as ImageIcon, Link2, Table2, Presentation, Check, X, ChevronDown, ChevronUp } from 'lucide-react-native';
import { Message } from '@/db/chat';
import { getToolPayload, getUiPayload, parseAttachments } from '@/utils/chatPayload';
import { isImageAttachment, isReadableAttachment } from '@/utils/attachments';
import { LinkKind, extractLinks, linkKind, linkTitle, toolSummary } from '@/utils/chatRows';
import { domainOf } from '@/utils/format';
import { MarkdownLite } from './MarkdownLite';
import { theme } from '@/theme/tokens';

// Separator & divider ------------------------------------------------------------------------------------
export const SeparatorRow = React.memo(function SeparatorRow({ label }: { label: string }) {
  return (
    <View style={styles.sepRow}>
      <Text style={styles.sepText}>{label}</Text>
    </View>
  );
});

export const UnreadRow = React.memo(function UnreadRow() {
  return (
    <View style={styles.unreadRow} accessibilityLabel="Unread messages below">
      <View style={styles.unreadLine} />
      <Text style={styles.unreadText}>Unread</Text>
      <View style={styles.unreadLine} />
    </View>
  );
});

// Thinking -----------------------------------------------------------------------------------------------
function Dot({ index }: { index: number }) {
  const v = useSharedValue(0.3);
  useEffect(() => {
    v.value = withDelay(index * 160, withRepeat(withSequence(withTiming(1, { duration: 380 }), withTiming(0.3, { duration: 380 })), -1));
  }, [v, index]);
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 2 }] }));
  return <Animated.View style={[styles.dot, style]} />;
}

export const ThinkingRow = React.memo(function ThinkingRow() {
  return (
    <View style={[styles.row, styles.rowBot]} accessibilityLabel="Thinking" accessibilityLiveRegion="polite">
      <View style={[styles.bubble, styles.bubbleBot, styles.thinkingBubble]}>
        <Dot index={0} />
        <Dot index={1} />
        <Dot index={2} />
      </View>
    </View>
  );
});

// Tool activity -----------------------------------------------------------------------------------------
export const ToolsRow = React.memo(function ToolsRow({ messages, defaultOpen = false }: { messages: Message[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const payloads = messages.map((m) => ({ id: m.id, p: getToolPayload(m) })).filter((x) => x.p !== null);
  if (payloads.length === 0) return null;
  const running = payloads.filter((x) => x.p?.status === 'running').length;
  const failed = payloads.some((x) => x.p?.status === 'error');
  return (
    <View style={styles.toolsWrap}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.toolsSummary}
        accessibilityRole="button"
        accessibilityLabel={`${toolSummary(running, payloads.length)}. ${open ? 'Hide' : 'Show'} details`}
      >
        <View style={[styles.statusDot, { backgroundColor: running > 0 ? theme.colors.warning : failed ? theme.colors.danger : theme.colors.success }]} />
        <Text style={styles.toolsText}>{toolSummary(running, payloads.length)}</Text>
        {open ? <ChevronUp size={14} color={theme.colors.muted} /> : <ChevronDown size={14} color={theme.colors.muted} />}
      </Pressable>
      {open ? (
        <View style={styles.toolsList}>
          {payloads.map(({ id, p }) =>
            p ? (
              <View key={id} style={styles.toolChip}>
                {p.status === 'ok' ? (
                  <Check size={13} color={theme.colors.success} />
                ) : p.status === 'error' ? (
                  <X size={13} color={theme.colors.danger} />
                ) : (
                  <View style={[styles.statusDot, { backgroundColor: theme.colors.warning }]} />
                )}
                <Text style={styles.toolLabel} numberOfLines={1}>
                  {p.label}
                </Text>
                {p.untrusted ? (
                  <View style={styles.untrusted}>
                    <Text style={styles.untrustedText}>untrusted</Text>
                  </View>
                ) : null}
              </View>
            ) : null
          )}
        </View>
      ) : null}
    </View>
  );
});

// Cards ---------------------------------------------------------------------------------------------------
export const CardRow = React.memo(function CardRow({ message }: { message: Message }) {
  const payload = getUiPayload(message);
  if (!payload) return null;
  const suggestions = payload.kind === 'suggestions';
  return (
    <View style={styles.cardWrap}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{suggestions ? 'Suggestions' : 'Finish this on your computer'}</Text>
        <Text style={styles.cardSub}>{payload.connector}</Text>
        {payload.items.map((item) => (
          <View key={item.name} style={styles.suggestion}>
            <View style={{ flex: 1 }}>
              <Text style={styles.suggestionName}>{item.name}</Text>
              <Text style={styles.suggestionWhy}>{item.why}</Text>
            </View>
            <View style={styles.statusChip}>
              <Text style={styles.statusChipText}>{item.status}</Text>
            </View>
          </View>
        ))}
        <View style={styles.desktopBadge}>
          <Text style={styles.desktopBadgeText}>Connect on desktop</Text>
        </View>
      </View>
    </View>
  );
});

export const SystemRow = React.memo(function SystemRow({ message }: { message: Message }) {
  if (message.status === 'error') {
    return (
      <View style={styles.sysWrap}>
        <View style={styles.errorBubble} accessibilityRole="alert">
          <Text style={styles.errorText}>{message.text}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.sysWrap}>
      <Text style={styles.sysText}>{message.text}</Text>
    </View>
  );
});

// Link / file card --------------------------------------------------------------------------------------
const KIND_COLOR: Record<LinkKind, string> = {
  doc: '#4285f4',
  sheet: '#0f9d58',
  slide: '#f4b400',
  pdf: '#e5484d',
  image: '#8b5cf6',
  link: '#8e8e93',
};

function KindIcon({ kind }: { kind: LinkKind }) {
  const color = KIND_COLOR[kind];
  const props = { size: 20, color };
  if (kind === 'doc' || kind === 'pdf') return <FileText {...props} />;
  if (kind === 'sheet') return <Table2 {...props} />;
  if (kind === 'slide') return <Presentation {...props} />;
  if (kind === 'image') return <ImageIcon {...props} />;
  return <Link2 {...props} />;
}

export function LinkCard({ url, onPress }: { url: string; onPress: (url: string) => void }) {
  const kind = linkKind(url);
  return (
    <Pressable
      onPress={() => onPress(url)}
      style={({ pressed }) => [styles.linkCard, pressed && { opacity: 0.8 }]}
      accessibilityRole="link"
      accessibilityLabel={`Link, ${linkTitle(url)}, ${domainOf(url)}`}
    >
      <View style={[styles.linkIcon, { backgroundColor: `${KIND_COLOR[kind]}22` }]}>
        <KindIcon kind={kind} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.linkTitle} numberOfLines={1}>
          {linkTitle(url)}
        </Text>
        <Text style={styles.linkDomain} numberOfLines={1}>
          {domainOf(url)}
        </Text>
      </View>
    </Pressable>
  );
}

// Bubble -------------------------------------------------------------------------------------------------
export interface ChatBubbleProps {
  message: Message;
  first: boolean;
  last: boolean;
  reaction?: string;
  highlight?: boolean;
  onLongPress: (message: Message) => void;
  onPressLink: (url: string) => void;
  onCopyCode: (code: string) => void;
  onRetry: () => void;
  onReactionPress: (message: Message) => void;
}

export const ChatBubble = React.memo(function ChatBubble({
  message,
  first,
  last,
  reaction,
  highlight,
  onLongPress,
  onPressLink,
  onCopyCode,
  onRetry,
  onReactionPress,
}: ChatBubbleProps) {
  const isUser = message.role === 'user';
  const attachments = parseAttachments(message);
  const links = !isUser && message.status !== 'streaming' ? extractLinks(message.text) : [];
  const empty = !message.text.trim() && attachments.length === 0;
  if (empty) return null;

  const corners = isUser
    ? { borderTopRightRadius: first ? 20 : 6, borderBottomRightRadius: last ? 20 : 6 }
    : { borderTopLeftRadius: first ? 20 : 6, borderBottomLeftRadius: last ? 20 : 6 };

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot, { marginTop: first ? 8 : 2 }]}>
      <View style={[styles.col, isUser ? { alignItems: 'flex-end' } : { alignItems: 'flex-start' }]}>
        <Pressable
          onLongPress={() => onLongPress(message)}
          delayLongPress={280}
          accessibilityRole="button"
          accessibilityLabel={`${isUser ? 'You' : 'Bot'}: ${message.text}`}
          accessibilityHint="Long press for message actions"
          accessibilityState={{ busy: message.status === 'streaming' }}
          style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot, corners, highlight && styles.highlight]}
        >
          {attachments.length > 0 ? (
            <View style={styles.attachments}>
              {attachments.map((attachment, index) =>
                isImageAttachment(attachment) ? (
                  <Image key={`${attachment.name}-${index}`} source={{ uri: attachment.uri }} style={styles.thumb} accessibilityLabel={`Image ${attachment.name}`} />
                ) : (
                  <View key={`${attachment.name}-${index}`} style={styles.fileChip}>
                    <FileText size={16} color={isUser ? theme.colors.bubbleYouText : theme.colors.muted} />
                    <View style={{ flexShrink: 1 }}>
                      <Text style={[styles.fileName, isUser && { color: theme.colors.bubbleYouText }]} numberOfLines={1}>
                        {attachment.name}
                      </Text>
                      <Text style={[styles.fileNote, isUser && { color: theme.colors.bubbleYouText, opacity: 0.7 }]}>
                        {isReadableAttachment(attachment) ? 'Text included' : 'Jasper cannot read this yet'}
                      </Text>
                    </View>
                  </View>
                )
              )}
              {attachments.some(isImageAttachment) ? <Text style={[styles.fileNote, isUser && { color: theme.colors.bubbleYouText, opacity: 0.7 }]}>Jasper can't read pictures yet</Text> : null}
            </View>
          ) : null}
          {message.text.trim() ? (
            <MarkdownLite text={message.text} onPressLink={onPressLink} onCopyCode={onCopyCode} color={isUser ? theme.colors.bubbleYouText : undefined} />
          ) : null}
        </Pressable>

        {links.map((url) => (
          <LinkCard key={url} url={url} onPress={onPressLink} />
        ))}

        {reaction ? (
          <Pressable
            onPress={() => onReactionPress(message)}
            style={[styles.reaction, isUser ? { alignSelf: 'flex-end', marginRight: 10 } : { alignSelf: 'flex-start', marginLeft: 10 }]}
            accessibilityRole="button"
            accessibilityLabel={`Reaction ${reaction}. Tap to remove`}
          >
            <Text style={styles.reactionText}>{reaction}</Text>
          </Pressable>
        ) : null}

        {isUser && message.status === 'queued' ? <Text style={styles.queued}>Waiting for connection</Text> : null}
        {isUser && message.status === 'error' ? (
          <Pressable onPress={onRetry} accessibilityRole="button" accessibilityLabel="Not sent. Tap to retry">
            <Text style={styles.failed}>Not sent. Tap to retry</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  sepRow: { alignItems: 'center', paddingVertical: 14 },
  sepText: { fontSize: theme.fontSizes.sm, color: theme.colors.faint },
  unreadRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 10 },
  unreadLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.accent },
  unreadText: { fontSize: theme.fontSizes.xs, color: theme.colors.accent, fontWeight: '600' },
  row: { flexDirection: 'row', paddingHorizontal: 14 },
  rowUser: { justifyContent: 'flex-end' },
  rowBot: { justifyContent: 'flex-start' },
  col: { maxWidth: '84%', gap: 4 },
  bubble: { borderRadius: theme.radii.bubble, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: theme.colors.bubbleYou },
  bubbleBot: { backgroundColor: theme.colors.bubbleBot },
  highlight: { borderWidth: 2, borderColor: theme.colors.accent },
  thinkingBubble: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 15, paddingHorizontal: 16, marginTop: 8 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.muted },
  attachments: { gap: 6, marginBottom: 6 },
  thumb: { width: 170, height: 170, borderRadius: 14 },
  fileChip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fileName: { fontSize: theme.fontSizes.sm, fontWeight: '600', color: theme.colors.text },
  fileNote: { fontSize: theme.fontSizes.xs, color: theme.colors.muted },
  reaction: {
    marginTop: -10,
    backgroundColor: theme.colors.circle,
    borderRadius: 14,
    paddingHorizontal: 7,
    paddingVertical: 2,
    ...theme.shadows.circle,
  },
  reactionText: { fontSize: 15 },
  queued: { fontSize: theme.fontSizes.xs, color: theme.colors.faint, marginRight: 4 },
  failed: { fontSize: theme.fontSizes.xs, color: theme.colors.danger, fontWeight: '600', marginRight: 4 },
  linkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.bubbleBot,
    borderRadius: theme.radii.bubble,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 220,
  },
  linkIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  linkTitle: { fontSize: theme.fontSizes.base, fontWeight: '500', color: theme.colors.text },
  linkDomain: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 1 },
  toolsWrap: { paddingHorizontal: 18, marginTop: 6, gap: 6 },
  toolsSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 4 },
  toolsText: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  toolsList: { gap: 6 },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: theme.colors.surface, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, maxWidth: '100%' },
  toolLabel: { fontSize: theme.fontSizes.sm, color: theme.colors.text, flexShrink: 1 },
  untrusted: { backgroundColor: theme.colors.warningBg, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 },
  untrustedText: { fontSize: theme.fontSizes.xs, color: theme.colors.warning },
  cardWrap: { paddingHorizontal: 14, marginTop: 8 },
  card: { backgroundColor: theme.colors.bubbleBot, borderRadius: theme.radii.card, padding: 14, maxWidth: '88%' },
  cardTitle: { fontSize: theme.fontSizes.body, fontWeight: '600', color: theme.colors.text },
  cardSub: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 2 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  suggestionName: { fontSize: theme.fontSizes.sm, fontWeight: '600', color: theme.colors.text },
  suggestionWhy: { fontSize: theme.fontSizes.xs, color: theme.colors.muted },
  statusChip: { backgroundColor: theme.colors.chipBg, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  statusChipText: { fontSize: theme.fontSizes.xs, color: theme.colors.chipText },
  desktopBadge: { alignSelf: 'flex-start', marginTop: 12, backgroundColor: theme.colors.background, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  desktopBadgeText: { fontSize: theme.fontSizes.xs, color: theme.colors.muted },
  sysWrap: { alignItems: 'center', paddingHorizontal: 24, marginVertical: 8 },
  sysText: { fontSize: theme.fontSizes.xs, color: theme.colors.faint, textAlign: 'center' },
  errorBubble: { backgroundColor: theme.colors.dangerBg, borderRadius: theme.radii.bubble, paddingHorizontal: 14, paddingVertical: 10 },
  errorText: { color: theme.colors.danger, fontSize: theme.fontSizes.base },
});
