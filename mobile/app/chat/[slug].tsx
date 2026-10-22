import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, Text, Alert, TouchableOpacity, Linking, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Attachment } from '@/api/types';
import { useChat } from '@/store/chat';
import { useBots } from '@/store/bots';
import { useAuth } from '@/auth/useAuth';
import { Message } from '@/db/chat';
import { Spinner, SheetModal, Button, EmptyState } from '@/components/ui';
import { Composer } from '@/components/chat/Composer';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { copyToClipboard } from '@/utils/clipboard';
import { MAX_ATTACHMENTS } from '@/utils/attachments';
import { attachmentFromFile, attachmentFromImage } from '@/attachments/files';
import { useVoiceRecorder } from '@/voice/useVoiceRecorder';
import { useSpeech } from '@/store/speech';
import { theme } from '@/theme/tokens';

const BOTTOM_TOLERANCE = 80;

export default function ChatScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { credentials } = useAuth();
  const { groups } = useBots();
  const {
    messagesByBot,
    streamingByBot,
    errorByBot,
    thumbsByBot,
    loadMessages,
    send,
    stop,
    retry,
    regenerate,
    editMessage,
    deleteMessage,
    setThumbs,
  } = useChat();

  const botSlug = typeof slug === 'string' ? slug : '';
  const messages = useMemo(() => messagesByBot[botSlug] ?? [], [messagesByBot, botSlug]);
  const streaming = streamingByBot[botSlug] ?? false;
  const error = errorByBot[botSlug] ?? null;
  const thumbs = thumbsByBot[botSlug] ?? {};

  const bot = useMemo(() => {
    for (const group of groups) {
      const found = group.bots.find((candidate) => candidate.slug === botSlug);
      if (found) return found;
    }
    return null;
  }, [groups, botSlug]);

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const atBottom = useRef(true);
  const listRef = useRef<FlashListRef<Message> | null>(null);

  const speakingMessageId = useSpeech((state) => state.messageId);
  const speak = useSpeech((state) => state.speak);
  const stopSpeaking = useSpeech((state) => state.stop);
  const speechError = useSpeech((state) => state.error);
  const clearSpeechError = useSpeech((state) => state.clearError);

  useEffect(() => {
    if (speechError) {
      Alert.alert('Read aloud', speechError);
      clearSpeechError();
    }
  }, [speechError, clearSpeechError]);

  const recorder = useVoiceRecorder(
    useCallback((text: string) => {
      setDraft((current) => (current.trim().length > 0 ? `${current} ${text}` : text));
    }, [])
  );

  useEffect(() => {
    if (credentials && botSlug) {
      loadMessages(botSlug, 50);
    }
  }, [botSlug, credentials, loadMessages]);

  const listData = useMemo(() => [...messages].reverse(), [messages]);

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    atBottom.current = true;
    setShowJumpToLatest(false);
  }, []);

  const lastMessage = messages[messages.length - 1];
  const lastText = lastMessage?.text ?? '';

  useEffect(() => {
    if (atBottom.current) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, [messages.length, lastText]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offset = event.nativeEvent.contentOffset.y;
    const isAtBottom = offset <= BOTTOM_TOLERANCE;
    atBottom.current = isAtBottom;
    setShowJumpToLatest(!isAtBottom);
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    const outgoing = attachments;
    setDraft('');
    setAttachments([]);
    void send(botSlug, text, outgoing);
  }, [attachments, botSlug, draft, send]);

  const addAttachments = useCallback((next: Attachment[]) => {
    setAttachments((current) => {
      const room = MAX_ATTACHMENTS - current.length;
      if (room <= 0) return current;
      return [...current, ...next.slice(0, room)];
    });
  }, []);

  const handleCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera permission needed', 'Allow camera access to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      addAttachments([attachmentFromImage(result.assets[0])]);
    }
  }, [addAttachments]);

  const handleGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo permission needed', 'Allow photo access to attach an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) {
      addAttachments([attachmentFromImage(result.assets[0])]);
    }
  }, [addAttachments]);

  const handleFiles = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const picked: Attachment[] = [];
      for (const asset of result.assets) {
        picked.push(
          await attachmentFromFile({
            name: asset.name,
            uri: asset.uri,
            mimeType: asset.mimeType,
          })
        );
      }
      addAttachments(picked);
    } catch (err) {
      Alert.alert(
        'Could not attach the file',
        err instanceof Error ? err.message : 'Please try another file.'
      );
    }
  }, [addAttachments]);

  const handleCopy = useCallback(async (message: Message) => {
    const copied = await copyToClipboard(message.text);
    Alert.alert(copied ? 'Copied' : 'Copy failed', copied ? 'The message is on the clipboard.' : 'The message could not be copied.');
  }, []);

  const handleLongPress = useCallback(
    (message: Message) => {
      const isUser = message.role === 'user';
      const isLastBot = isLastBotMessageId(messages, message.id);
      const buttons: { text: string; onPress: () => void; style?: 'destructive' | 'cancel' }[] = [
        { text: 'Copy', onPress: () => void handleCopy(message) },
        { text: 'Delete', onPress: () => deleteMessage(botSlug, message.id), style: 'destructive' },
      ];

      if (isUser) {
        buttons.push({
          text: 'Edit',
          onPress: () => {
            const text = editMessage(botSlug, message.id);
            if (text !== null) {
              setDraft(text);
            }
          },
        });
      }

      if (isLastBot) {
        buttons.push({ text: 'Regenerate', onPress: () => void regenerate(botSlug) });
      }

      buttons.push({ text: 'Cancel', onPress: () => undefined, style: 'cancel' });

      Alert.alert('Message actions', '', buttons);
    },
    [botSlug, deleteMessage, editMessage, handleCopy, messages, regenerate]
  );

  const handleOpenLink = useCallback((url: string) => {
    setPendingLink(url);
  }, []);

  const confirmOpenLink = useCallback(async () => {
    const url = pendingLink;
    setPendingLink(null);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Cannot open link', 'This link could not be opened on this phone.');
    }
  }, [pendingLink]);

  const lastAssistant = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') return messages[index];
    }
    return null;
  }, [messages]);
  const thinking = streaming && (!lastAssistant || lastAssistant.text.length === 0);

  if (!botSlug) {
    return (
      <View style={styles.container}>
        <EmptyState title="No chat selected" subtitle="Pick a bot from the Chats tab." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(bot?.display_name ?? botSlug).charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name}>{bot?.display_name ?? botSlug}</Text>
          {bot?.position ? <Text style={styles.position}>{bot.position}</Text> : null}
        </View>
        {thinking ? (
          <View style={styles.thinking}>
            <Spinner size="small" />
            <Text style={styles.thinkingText}>Thinking</Text>
          </View>
        ) : null}
      </View>

      <FlashList
        ref={listRef}
        data={listData}
        inverted
        keyExtractor={(item: Message) => String(item.id)}
        renderItem={({ item }: { item: Message }) => (
          <MessageBubble
            message={item}
            isLastBotMessage={isLastBotMessageId(messages, item.id)}
            thumb={thumbs[item.id] ?? null}
            onLongPress={() => handleLongPress(item)}
            onPressLink={handleOpenLink}
            onCopyCode={(code: string) => void copyToClipboard(code)}
            onThumbsUp={() => setThumbs(botSlug, item.id, true)}
            onThumbsDown={() => setThumbs(botSlug, item.id, false)}
            speaking={speakingMessageId === item.id}
            onSpeak={
              item.role === 'assistant' && item.text.trim().length > 0
                ? () => void speak(item)
                : undefined
            }
            onStopSpeak={() => void stopSpeaking()}
          />
        )}
        onScroll={handleScroll}
        scrollEventThrottle={50}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View style={styles.emptyFlip}>
              <EmptyState title="No messages yet" subtitle="Say hello to start the conversation." />
            </View>
          </View>
        }
      />

      {showJumpToLatest ? (
        <TouchableOpacity
          style={styles.jumpButton}
          onPress={scrollToLatest}
          accessibilityRole="button"
          accessibilityLabel="Jump to latest"
        >
          <Text style={styles.jumpLabel}>Jump to latest</Text>
        </TouchableOpacity>
      ) : null}

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={() => void retry(botSlug)} style={styles.retryButton} />
        </View>
      ) : null}

      <Composer
        text={draft}
        onChangeText={setDraft}
        streaming={streaming}
        onSend={handleSend}
        onStop={() => stop(botSlug)}
        placeholder={`Message ${bot?.display_name ?? botSlug}`}
        attachments={attachments}
        onAddFromCamera={() => void handleCamera()}
        onAddFromGallery={() => void handleGallery()}
        onAddFromFiles={() => void handleFiles()}
        onRemoveAttachment={(index) =>
          setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))
        }
        recording={recorder.recording}
        recordingSeconds={recorder.seconds}
        transcribing={recorder.transcribing}
        onStartRecording={() => void recorder.start()}
        onStopRecording={() => void recorder.stop()}
        onCancelRecording={() => void recorder.cancel()}
        voiceError={recorder.error}
        onDismissVoiceError={recorder.clearError}
      />

      <SheetModal visible={pendingLink !== null} onClose={() => setPendingLink(null)} title="Open link">
        <Text style={styles.linkText}>{pendingLink}</Text>
        <View style={styles.linkActions}>
          <Button title="Cancel" variant="secondary" onPress={() => setPendingLink(null)} style={styles.linkButton} />
          <Button title="Open" onPress={() => void confirmOpenLink()} style={styles.linkButton} />
        </View>
      </SheetModal>
    </View>
  );
}

function isLastBotMessageId(messages: Message[], id: number): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant') {
      return messages[index].id === id;
    }
  }
  return false;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: theme.fontSizes.base,
  },
  headerText: {
    flex: 1,
  },
  name: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.lg,
    fontWeight: '600',
  },
  position: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
  },
  thinking: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  thinkingText: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
  },
  listContent: {
    paddingVertical: 8,
  },
  empty: {
    paddingTop: 48,
  },
  emptyFlip: {
    transform: [{ scaleY: -1 }],
  },
  jumpButton: {
    position: 'absolute',
    bottom: 88,
    alignSelf: 'center',
    backgroundColor: theme.colors.raised,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  jumpLabel: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.sm,
    fontWeight: '600',
  },
  errorBanner: {
    position: 'absolute',
    bottom: 88,
    left: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.danger,
    borderRadius: theme.radii.card,
    padding: 12,
  },
  errorText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.fontSizes.sm,
  },
  retryButton: {
    marginLeft: 12,
  },
  linkText: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
  },
  linkActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  linkButton: {
    minWidth: 96,
  },
});
