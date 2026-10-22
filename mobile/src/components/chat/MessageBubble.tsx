import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import React from 'react';
import { Message } from '@/db/chat';
import { getToolPayload, getUiPayload, parseAttachments } from '@/utils/chatPayload';
import { isImageAttachment, isReadableAttachment } from '@/utils/attachments';
import { Chip, Spinner } from '@/components/ui';
import { MarkdownLite } from './MarkdownLite';
import { theme } from '@/theme/tokens';

export interface MessageBubbleProps {
  message: Message;
  isLastBotMessage?: boolean;
  thumb?: boolean | null;
  onLongPress?: () => void;
  onPressLink?: (url: string) => void;
  onCopyCode?: (code: string) => void;
  onThumbsUp?: () => void;
  onThumbsDown?: () => void;
  speaking?: boolean;
  onSpeak?: () => void;
  onStopSpeak?: () => void;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({
  message,
  isLastBotMessage = false,
  thumb = null,
  onLongPress,
  onPressLink,
  onCopyCode,
  onThumbsUp,
  onThumbsDown,
  speaking = false,
  onSpeak,
  onStopSpeak,
}: MessageBubbleProps) {
  if (message.role === 'tool') {
    return <ToolChip message={message} />;
  }

  if (message.role === 'ui') {
    return <CardMessage message={message} />;
  }

  if (message.role === 'system') {
    if (message.status === 'error') {
      return (
        <View style={styles.systemRow}>
          <View style={styles.errorBubble}>
            <Text style={styles.errorText}>{message.text}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.systemRow}>
        <Text style={styles.divider}>{message.text}</Text>
      </View>
    );
  }

  const isUser = message.role === 'user';
  const showThumbs = isLastBotMessage && message.status === 'done' && (onThumbsUp !== undefined || onThumbsDown !== undefined);
  const attachments = parseAttachments(message);

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowBot]}>
      <TouchableOpacity
        style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleBot]}
        onLongPress={onLongPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={isUser ? 'Your message' : 'Bot message'}
      >
        {attachments.length > 0 ? (
          <View style={styles.attachments}>
            {attachments.map((attachment, index) =>
              isImageAttachment(attachment) ? (
                <View key={`${attachment.name}-${index}`} style={styles.attachmentImageWrap}>
                  <Image
                    source={{ uri: attachment.uri }}
                    style={styles.attachmentImage}
                    accessibilityLabel={`Image ${attachment.name}`}
                  />
                  <Text style={styles.attachmentNote}>not readable by the AI</Text>
                </View>
              ) : (
                <View key={`${attachment.name}-${index}`} style={styles.attachmentFile}>
                  <Text style={styles.attachmentName} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                  <Text style={styles.attachmentNote}>
                    {isReadableAttachment(attachment) ? 'text included' : 'not readable by the AI'}
                  </Text>
                </View>
              )
            )}
          </View>
        ) : null}
        <MarkdownLite text={message.text} onPressLink={onPressLink} onCopyCode={onCopyCode} />
        <View style={styles.meta}>
          {!isUser && onSpeak ? (
            <TouchableOpacity
              onPress={speaking ? onStopSpeak : onSpeak}
              style={styles.speakButton}
              accessibilityRole="button"
              accessibilityLabel={speaking ? 'Stop reading' : 'Read aloud'}
            >
              <Text style={styles.speakIcon}>{speaking ? '\u25A0' : '\u25B6'}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.time}>{formatTime(message.ts)}</Text>
          {showThumbs ? (
            <View style={styles.thumbs}>
              <TouchableOpacity
                onPress={onThumbsUp}
                style={[styles.thumbButton, thumb === true ? styles.thumbSelected : null]}
                accessibilityRole="button"
                accessibilityLabel="Thumbs up"
              >
                <Text style={styles.thumbIcon}>{'\u{1F44D}'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onThumbsDown}
                style={[styles.thumbButton, thumb === false ? styles.thumbSelected : null]}
                accessibilityRole="button"
                accessibilityLabel="Thumbs down"
              >
                <Text style={styles.thumbIcon}>{'\u{1F44E}'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    </View>
  );
}

function ToolChip({ message }: { message: Message }) {
  const payload = getToolPayload(message);
  if (!payload) {
    return null;
  }

  const isRunning = payload.status === 'running';

  return (
    <View style={styles.toolRow}>
      <View style={styles.toolChip}>
        {isRunning ? (
          <Spinner size="small" color={theme.colors.warning} />
        ) : (
          <Text style={[styles.toolIcon, payload.status === 'ok' ? styles.toolOk : styles.toolError]}>
            {payload.status === 'ok' ? '\u2713' : '\u2715'}
          </Text>
        )}
        <Text style={styles.toolLabel}>{payload.label}</Text>
        {payload.untrusted ? (
          <View style={styles.untrustedBadge}>
            <Text style={styles.untrustedText}>untrusted</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function CardMessage({ message }: { message: Message }) {
  const payload = getUiPayload(message);
  if (!payload) {
    return null;
  }

  const isSuggestions = payload.kind === 'suggestions';

  return (
    <View style={styles.toolRow}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>
          {isSuggestions ? 'Suggestions' : 'Finish this on your computer'}
        </Text>
        <Text style={styles.cardSubtitle}>{payload.connector}</Text>

        {payload.items.map((item) => (
          <View key={item.name} style={styles.suggestionRow}>
            <View style={styles.suggestionText}>
              <Text style={styles.suggestionName}>{item.name}</Text>
              <Text style={styles.suggestionWhy}>{item.why}</Text>
            </View>
            <Chip textStyle={styles.suggestionStatus}>{item.status}</Chip>
          </View>
        ))}

        <View style={styles.desktopBadge}>
          <Text style={styles.desktopBadgeText}>Connect on desktop</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    marginVertical: 3,
  },
  rowUser: {
    justifyContent: 'flex-end',
  },
  rowBot: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: theme.radii.bubble,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleUser: {
    backgroundColor: theme.colors.bubbleYou,
  },
  bubbleBot: {
    backgroundColor: theme.colors.bubbleBot,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: theme.spacing.sm,
    marginTop: 4,
  },
  time: {
    fontSize: theme.fontSizes.xs,
    color: theme.colors.muted,
  },
  speakButton: {
    paddingHorizontal: 2,
  },
  speakIcon: {
    fontSize: 11,
    color: theme.colors.muted,
  },
  thumbs: {
    flexDirection: 'row',
    marginLeft: 'auto',
    gap: 4,
  },
  thumbButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: theme.radii.pill,
  },
  thumbSelected: {
    backgroundColor: theme.colors.raised,
  },
  thumbIcon: {
    fontSize: 12,
  },
  systemRow: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginVertical: 6,
  },
  divider: {
    fontSize: theme.fontSizes.xs,
    color: theme.colors.muted,
    textAlign: 'center',
  },
  errorBubble: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radii.bubble,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
  },
  toolRow: {
    paddingHorizontal: 12,
    marginVertical: 3,
  },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    backgroundColor: theme.colors.raised,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  toolIcon: {
    fontSize: theme.fontSizes.base,
    fontWeight: '600',
  },
  toolOk: {
    color: theme.colors.success,
  },
  toolError: {
    color: theme.colors.danger,
  },
  toolLabel: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.sm,
  },
  untrustedBadge: {
    backgroundColor: 'rgba(245,158,11,0.2)',
    borderRadius: theme.radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  untrustedText: {
    color: theme.colors.warning,
    fontSize: theme.fontSizes.xs,
  },
  attachments: {
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.xs,
  },
  attachmentImageWrap: {
    alignSelf: 'flex-start',
    gap: 2,
  },
  attachmentImage: {
    width: 160,
    height: 160,
    borderRadius: theme.radii.button,
  },
  attachmentFile: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radii.button,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  attachmentName: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.xs,
  },
  attachmentNote: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
  },
  card: {
    backgroundColor: theme.colors.raised,
    borderRadius: theme.radii.card,
    padding: 12,
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
    marginTop: 2,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  suggestionText: {
    flex: 1,
  },
  suggestionName: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.sm,
    fontWeight: '600',
  },
  suggestionWhy: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
  },
  suggestionStatus: {
    textTransform: 'none',
  },
  desktopBadge: {
    alignSelf: 'flex-start',
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  desktopBadgeText: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.xs,
  },
});
