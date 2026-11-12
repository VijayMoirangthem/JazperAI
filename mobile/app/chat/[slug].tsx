/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList, FlashListRef } from '@shopify/flash-list';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { ArrowDown, ChevronDown, ChevronLeft, ChevronUp, Copy, Pencil, Quote, RefreshCw, Search, Trash2, Volume2, X } from 'lucide-react-native';
import { Attachment } from '@/api/types';
import { useChat } from '@/store/chat';
import { useBots } from '@/store/bots';
import { useAuth } from '@/auth/useAuth';
import { useHome } from '@/store/home';
import { useSettings } from '@/store/settings';
import { useSpeech } from '@/store/speech';
import { useSystem } from '@/store/system';
import { Message, clearMessages } from '@/db/chat';
import { firstUnreadId, listReactions, loadDraft, saveDraft, searchMessages, setReaction } from '@/db/meta';
import { Mascot, MascotState } from '@/components/Mascot';
import { Composer } from '@/components/chat/Composer';
import { ChatBubble, CardRow, SeparatorRow, SystemRow, ThinkingRow, ToolsRow, UnreadRow } from '@/components/chat/ChatRows';
import { CircleButton, useToast } from '@/components/ui/kit';
import { Button, EmptyState } from '@/components/ui';
import { SheetRow } from '@/components/ui/SheetRow';
import { copyToClipboard } from '@/utils/clipboard';
import { MAX_ATTACHMENTS } from '@/utils/attachments';
import { attachmentFromFile, attachmentFromImage } from '@/attachments/files';
import { ChatRow, buildRows } from '@/utils/chatRows';
import { domainOf } from '@/utils/format';
import { useVoiceRecorder } from '@/voice/useVoiceRecorder';
import { theme } from '@/theme/tokens';

const BOTTOM_TOLERANCE = 80;
const EMOJIS = ['👍', '👎', '❤️', '😂', '😮', '🙏'];
const HEADER_HEIGHT = 64;

/** Re-renders at most every `ms` while the value keeps changing (smooth streaming). */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const elapsed = Date.now() - last.current;
    if (elapsed >= ms) {
      last.current = Date.now();
      setShown(value);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, ms - elapsed);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, ms]);
  return shown;
}

export default function ChatScreen() {
  const { slug, m } = useLocalSearchParams<{ slug: string; m?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const credentials = useAuth((s) => s.credentials);
  const groups = useBots((s) => s.groups);
  const messagesByBot = useChat((s) => s.messagesByBot);
  const streamingByBot = useChat((s) => s.streamingByBot);
  const errorByBot = useChat((s) => s.errorByBot);
  const { loadMessages, send, stop, retry, regenerate, editMessage, deleteMessage, setThumbs } = useChat.getState();
  const showToolDetails = useSettings((s) => s.showToolDetails);
  const readAloud = useSettings((s) => s.readAloud);
  const voiceAutoSend = useSettings((s) => s.voiceAutoSend);
  const offline = useSystem((s) => s.banner?.kind === 'offline');
  const markRead = useHome((s) => s.markRead);
  const meta = useHome((s) => s.meta);

  const botSlug = typeof slug === 'string' ? slug : '';
  const rawMessages = messagesByBot[botSlug];
  const streaming = streamingByBot[botSlug] ?? false;
  const error = errorByBot[botSlug] ?? null;
  const messages = useThrottled(rawMessages ?? [], 70);

  const bot = useMemo(() => groups.flatMap((g) => g.bots).find((b) => b.slug === botSlug) ?? null, [groups, botSlug]);
  const botName = bot?.display_name ?? botSlug;

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [quote, setQuote] = useState<string | null>(null);
  const [pendingLink, setPendingLink] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<Message | null>(null);
  const [selectText, setSelectText] = useState<string | null>(null);
  const [chatMenu, setChatMenu] = useState(false);
  const [reactions, setReactions] = useState<Record<number, string>>({});
  const [newCount, setNewCount] = useState(0);
  const [showJump, setShowJump] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
  const unreadFrom = useRef<number | null>(null);
  const atBottom = useRef(true);
  const lastLength = useRef(0);
  const listRef = useRef<FlashListRef<ChatRow> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const speakingId = useSpeech((s) => s.messageId);
  const speak = useSpeech((s) => s.speak);
  const stopSpeaking = useSpeech((s) => s.stop);
  const speechError = useSpeech((s) => s.error);
  const clearSpeechError = useSpeech((s) => s.clearError);

  // Load history, reactions, the draft and remember where the unread messages start.
  useEffect(() => {
    if (!credentials || !botSlug) return;
    unreadFrom.current = firstUnreadId(botSlug);
    loadMessages(botSlug, 80);
    setReactions(listReactions(botSlug));
    setDraft(loadDraft(botSlug));
    markRead(botSlug);
  }, [botSlug, credentials, loadMessages, markRead]);

  // New messages while the chat is open count as read once they are visible.
  useEffect(() => {
    if (atBottom.current && botSlug) markRead(botSlug);
  }, [rawMessages, botSlug, markRead]);

  useEffect(() => {
    if (speechError) {
      toast(speechError);
      clearSpeechError();
    }
  }, [speechError, clearSpeechError, toast]);

  // Read replies aloud automatically when a reply finishes.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && readAloud) {
      const last = [...(useChat.getState().messagesByBot[botSlug] ?? [])].reverse().find((x) => x.role === 'assistant');
      if (last && last.text.trim()) void speak(last);
    }
    wasStreaming.current = streaming;
  }, [streaming, readAloud, botSlug, speak]);

  const onDraft = useCallback(
    (text: string) => {
      setDraft(text);
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = setTimeout(() => saveDraft(botSlug, text), 400);
    },
    [botSlug]
  );

  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    []
  );

  const sendNow = useCallback(
    (text: string, outgoing: Attachment[]) => {
      const withQuote = quote
        ? `${quote
            .split('\n')
            .map((line) => `> ${line}`)
            .join('\n')}\n\n${text}`
        : text;
      setQuote(null);
      void send(botSlug, withQuote, outgoing);
    },
    [botSlug, quote, send]
  );

  const recorder = useVoiceRecorder(
    useCallback(
      (text: string) => {
        if (useSettings.getState().voiceAutoSend) {
          sendNow(text, []);
        } else {
          setDraft((current) => (current.trim().length > 0 ? `${current} ${text}` : text));
        }
      },
      [sendNow]
    )
  );
  void voiceAutoSend;

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    const outgoing = attachments;
    setDraft('');
    saveDraft(botSlug, '');
    setAttachments([]);
    sendNow(text, outgoing);
    atBottom.current = true;
  }, [attachments, botSlug, draft, sendNow]);

  const addAttachments = useCallback((next: Attachment[]) => {
    setAttachments((current) => {
      const room = MAX_ATTACHMENTS - current.length;
      return room <= 0 ? current : [...current, ...next.slice(0, room)];
    });
  }, []);

  const openSettings = () => void Linking.openSettings();

  const handleCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow the camera to take a photo for this chat.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: openSettings },
      ]);
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) addAttachments([attachmentFromImage(result.assets[0])]);
  }, [addAttachments]);

  const handleGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photos to attach a picture.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: openSettings },
      ]);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!result.canceled && result.assets[0]) addAttachments([attachmentFromImage(result.assets[0])]);
  }, [addAttachments]);

  const handleFiles = useCallback(async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      const picked: Attachment[] = [];
      for (const asset of result.assets) {
        picked.push(await attachmentFromFile({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType }));
      }
      addAttachments(picked);
    } catch (err) {
      Alert.alert('Could not attach the file', err instanceof Error ? err.message : 'Please try another file.');
    }
  }, [addAttachments]);

  // Rows ------------------------------------------------------------------------------------------------
  const rows = useMemo(
    () => buildRows(messages, { unreadFromId: unreadFrom.current, streaming }),
    [messages, streaming]
  );
  const data = useMemo(() => [...rows].reverse(), [rows]);

  const lastBotId = useMemo(() => [...messages].reverse().find((x) => x.role === 'assistant')?.id ?? null, [messages]);

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    atBottom.current = true;
    setShowJump(false);
    setNewCount(0);
  }, []);

  useEffect(() => {
    const grew = messages.length - lastLength.current;
    lastLength.current = messages.length;
    if (grew > 0 && !atBottom.current) setNewCount((n) => n + grew);
  }, [messages.length]);

  const lastText = messages[messages.length - 1]?.text ?? '';
  useEffect(() => {
    if (atBottom.current) listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [messages.length, lastText, streaming]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const isBottom = event.nativeEvent.contentOffset.y <= BOTTOM_TOLERANCE;
    if (isBottom !== atBottom.current) {
      atBottom.current = isBottom;
      setShowJump(!isBottom);
      if (isBottom) setNewCount(0);
    }
  }, []);

  const scrollToMessage = useCallback(
    (id: number) => {
      const index = data.findIndex((row) => row.type === 'msg' && row.message.id === id);
      if (index >= 0) {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.4 });
        setHighlightId(id);
        setTimeout(() => setHighlightId((current) => (current === id ? null : current)), 1800);
      }
    },
    [data]
  );

  // Jump to a message opened from search.
  const handledJump = useRef<string | null>(null);
  useEffect(() => {
    if (m && handledJump.current !== m && data.length > 0) {
      handledJump.current = String(m);
      const id = Number(m);
      if (Number.isFinite(id)) setTimeout(() => scrollToMessage(id), 350);
    }
  }, [m, data, scrollToMessage]);

  // In-chat search --------------------------------------------------------------------------------------
  const hits = useMemo(() => (searchOpen && query.trim().length > 1 ? searchMessages(query, 100, botSlug).map((h) => h.id) : []), [searchOpen, query, botSlug]);
  useEffect(() => {
    setHitIndex(0);
    if (hits.length > 0) scrollToMessage(hits[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits.length, query]);
  const stepHit = (delta: number) => {
    if (hits.length === 0) return;
    const next = (hitIndex + delta + hits.length) % hits.length;
    setHitIndex(next);
    scrollToMessage(hits[next]);
  };

  // Message actions -------------------------------------------------------------------------------------
  const handleCopyCode = useCallback((code: string) => {
    void copyToClipboard(code);
    toast('Code copied');
  }, [toast]);

  const closeMenu = () => setMenuFor(null);

  const react = (message: Message, emoji: string) => {
    const current = reactions[message.id];
    const next = current === emoji ? null : emoji;
    setReaction(message.id, next);
    setReactions((r) => {
      const copy = { ...r };
      if (next) copy[message.id] = next;
      else delete copy[message.id];
      return copy;
    });
    if (message.role === 'assistant' && next && (emoji === '👍' || emoji === '👎')) setThumbs(botSlug, message.id, emoji === '👍');
    closeMenu();
  };

  const removeReaction = useCallback((message: Message) => {
    setReaction(message.id, null);
    setReactions((r) => {
      const copy = { ...r };
      delete copy[message.id];
      return copy;
    });
  }, []);

  const doAction = async (action: 'copy' | 'quote' | 'edit' | 'regenerate' | 'speak' | 'select' | 'delete') => {
    const message = menuFor;
    if (!message) return;
    closeMenu();
    if (action === 'copy') toast((await copyToClipboard(message.text)) ? 'Copied' : "Couldn't copy");
    if (action === 'quote') setQuote(message.text.slice(0, 200));
    if (action === 'edit') {
      const text = editMessage(botSlug, message.id);
      if (text !== null) setDraft(text);
    }
    if (action === 'regenerate') void regenerate(botSlug);
    if (action === 'speak') void speak(message);
    if (action === 'select') setSelectText(message.text);
    if (action === 'delete') deleteMessage(botSlug, message.id);
  };

  const confirmOpenLink = async () => {
    const url = pendingLink;
    setPendingLink(null);
    if (!url) return;
    try {
      await Linking.openURL(url);
    } catch {
      toast("This link couldn't be opened.");
    }
  };

  const renderItem = useCallback(
    ({ item }: { item: ChatRow }) => {
      switch (item.type) {
        case 'sep':
          return <SeparatorRow label={item.label} />;
        case 'unread':
          return <UnreadRow />;
        case 'thinking':
          return <ThinkingRow />;
        case 'tools':
          return <ToolsRow messages={item.messages} defaultOpen={showToolDetails} />;
        case 'ui':
          return <CardRow message={item.message} />;
        case 'system':
          return <SystemRow message={item.message} />;
        default:
          return (
            <ChatBubble
              message={item.message}
              first={item.first}
              last={item.last}
              reaction={reactions[item.message.id]}
              highlight={highlightId === item.message.id}
              onLongPress={setMenuFor}
              onPressLink={setPendingLink}
              onCopyCode={handleCopyCode}
              onRetry={() => void retry(botSlug)}
              onReactionPress={removeReaction}
            />
          );
      }
    },
    [botSlug, handleCopyCode, highlightId, reactions, removeReaction, retry, showToolDetails]
  );

  if (!botSlug) {
    return (
      <View style={styles.root}>
        <EmptyState title="No chat selected" subtitle="Pick a bot from Home." />
      </View>
    );
  }

  const state: MascotState = streaming ? (messages.some((x) => x.role === 'tool' && x.status === 'streaming') ? 'working' : 'thinking') : 'idle';
  const muted = meta[botSlug]?.muted;

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <FlashList
        ref={listRef}
        data={data}
        inverted
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.type}
        renderItem={renderItem}
        onScroll={handleScroll}
        scrollEventThrottle={50}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.top + HEADER_HEIGHT + (searchOpen ? 56 : 0) }}
        ListEmptyComponent={
          <View style={{ paddingTop: 80 }}>
            <EmptyState title="No messages yet" subtitle={`Say hello to ${botName}.`} />
          </View>
        }
      />

      {/* Floating header */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.background, opacity: 0.94 }]} pointerEvents="none" />
        <View style={styles.headerRow}>
          <CircleButton label="Back" onPress={() => router.back()}>
            <ChevronLeft size={22} color={theme.colors.text} />
          </CircleButton>
          <Pressable
            onPress={() => router.push(`/bot/${botSlug}` as Href)}
            style={[styles.namePill, theme.shadows.circle]}
            accessibilityRole="button"
            accessibilityLabel={`${botName}. Open profile`}
          >
            <Mascot slug={botSlug} size={30} state={state} animated />
            <Text style={styles.nameText} numberOfLines={1}>
              {botName}
            </Text>
            {muted ? <Text style={styles.mutedTag}>Muted</Text> : null}
          </Pressable>
          <View style={{ flex: 1 }} />
          <CircleButton label="More" onPress={() => setChatMenu(true)}>
            <Text style={styles.ellipsis}>•••</Text>
          </CircleButton>
        </View>
        {searchOpen ? (
          <View style={styles.searchBar}>
            <Search size={16} color={theme.colors.faint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search in this chat"
              placeholderTextColor={theme.colors.faint}
              autoFocus
              style={styles.searchInput}
              accessibilityLabel="Search in this chat"
              returnKeyType="search"
            />
            <Text style={styles.searchCount}>{hits.length > 0 ? `${hitIndex + 1} of ${hits.length}` : query.trim().length > 1 ? '0' : ''}</Text>
            <Pressable onPress={() => stepHit(-1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Previous match">
              <ChevronUp size={20} color={theme.colors.text} />
            </Pressable>
            <Pressable onPress={() => stepHit(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Next match">
              <ChevronDown size={20} color={theme.colors.text} />
            </Pressable>
            <Pressable
              onPress={() => {
                setSearchOpen(false);
                setQuery('');
                Keyboard.dismiss();
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close search"
            >
              <X size={20} color={theme.colors.text} />
            </Pressable>
          </View>
        ) : null}
      </View>

      {speakingId !== null ? (
        <Pressable onPress={() => void stopSpeaking()} style={[styles.speakPill, { top: insets.top + HEADER_HEIGHT + 8 }]} accessibilityRole="button" accessibilityLabel="Stop reading aloud">
          <Volume2 size={16} color={theme.colors.pillText} />
          <Text style={styles.speakText}>Stop</Text>
        </Pressable>
      ) : null}

      {showJump ? (
        <Pressable onPress={scrollToLatest} style={[styles.jump, theme.shadows.circle]} accessibilityRole="button" accessibilityLabel={newCount > 0 ? `${newCount} new messages. Jump to latest` : 'Jump to latest'}>
          <ArrowDown size={16} color={theme.colors.text} />
          {newCount > 0 ? <Text style={styles.jumpText}>{newCount}</Text> : null}
        </Pressable>
      ) : null}

      {error ? (
        <View style={styles.errorBanner} accessibilityRole="alert">
          <Text style={styles.errorText}>{error}</Text>
          <Button title="Retry" variant="secondary" onPress={() => void retry(botSlug)} style={{ height: 38, minHeight: 38, paddingVertical: 6 }} />
        </View>
      ) : null}

      <Composer
        text={draft}
        onChangeText={onDraft}
        streaming={streaming}
        onSend={handleSend}
        onStop={() => stop(botSlug)}
        placeholder={`Ask ${botName}`}
        attachments={attachments}
        onAddFromCamera={() => void handleCamera()}
        onAddFromGallery={() => void handleGallery()}
        onAddFromFiles={() => void handleFiles()}
        onRemoveAttachment={(index) => setAttachments((c) => c.filter((_, i) => i !== index))}
        recording={recorder.recording}
        recordingSeconds={recorder.seconds}
        recordingLevel={recorder.level}
        transcribing={recorder.transcribing}
        onStartRecording={() => { void stopSpeaking(); void recorder.start(); }}
        onStopRecording={() => void recorder.stop()}
        onCancelRecording={() => void recorder.cancel()}
        voiceError={recorder.error}
        onDismissVoiceError={recorder.clearError}
        quote={quote}
        onClearQuote={() => setQuote(null)}
        offline={offline}
      />

      {/* Message menu: emoji bar + actions */}
      <Modal visible={menuFor !== null} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={styles.overlay} onPress={closeMenu} accessibilityLabel="Close menu" accessibilityRole="button">
          {menuFor ? (
            <Pressable style={styles.menuCol} onPress={() => undefined}>
              <View style={[styles.emojiBar, theme.shadows.composer]}>
                {EMOJIS.map((emoji) => (
                  <Pressable key={emoji} onPress={() => react(menuFor, emoji)} style={[styles.emojiBtn, reactions[menuFor.id] === emoji && { backgroundColor: theme.colors.chipBg }]} accessibilityRole="button" accessibilityLabel={`React ${emoji}`}>
                    <Text style={styles.emoji}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={[styles.menuCard, theme.shadows.composer]}>
                <SheetRow label="Copy" icon={<Copy size={19} color={theme.colors.text} />} onPress={() => void doAction('copy')} />
                <SheetRow label="Reply with quote" icon={<Quote size={19} color={theme.colors.text} />} onPress={() => void doAction('quote')} />
                {menuFor.role === 'user' ? <SheetRow label="Edit and resend" icon={<Pencil size={19} color={theme.colors.text} />} onPress={() => void doAction('edit')} /> : null}
                {menuFor.id === lastBotId && menuFor.role === 'assistant' ? <SheetRow label="Regenerate" icon={<RefreshCw size={19} color={theme.colors.text} />} onPress={() => void doAction('regenerate')} /> : null}
                {menuFor.role === 'assistant' ? <SheetRow label="Speak" icon={<Volume2 size={19} color={theme.colors.text} />} onPress={() => void doAction('speak')} /> : null}
                <SheetRow label="Select text" icon={<Text style={styles.selIcon}>Aa</Text>} onPress={() => void doAction('select')} />
                <SheetRow label="Delete" danger icon={<Trash2 size={19} color={theme.colors.danger} />} onPress={() => void doAction('delete')} />
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>

      {/* Chat menu */}
      <Modal visible={chatMenu} transparent animationType="fade" onRequestClose={() => setChatMenu(false)}>
        <Pressable style={[styles.overlay, { justifyContent: 'flex-start', alignItems: 'flex-end', paddingTop: insets.top + 56 }]} onPress={() => setChatMenu(false)} accessibilityLabel="Close menu" accessibilityRole="button">
          <View style={[styles.menuCard, theme.shadows.composer, { minWidth: 230, marginRight: 14 }]}>
            <SheetRow label="Search in chat" icon={<Search size={19} color={theme.colors.text} />} onPress={() => { setChatMenu(false); setSearchOpen(true); }} />
            <SheetRow label={muted ? 'Unmute' : 'Mute'} onPress={() => { setChatMenu(false); useHome.getState().toggleMute(botSlug); }} />
            <SheetRow label={readAloud && voiceAutoSend ? 'Stop voice conversation' : 'Start voice conversation'} onPress={() => { setChatMenu(false); const on = !(readAloud && voiceAutoSend); useSettings.getState().setReadAloud(on); useSettings.getState().setVoiceAutoSend(on); if (!on) void stopSpeaking(); }} />
            <SheetRow label={readAloud ? 'Stop reading replies aloud' : 'Read replies aloud'} onPress={() => { setChatMenu(false); useSettings.getState().setReadAloud(!readAloud); }} />
            <SheetRow label="View profile" onPress={() => { setChatMenu(false); router.push(`/bot/${botSlug}` as Href); }} />
            <SheetRow label="Clear chat" danger onPress={() => { setChatMenu(false); clearMessages(botSlug); loadMessages(botSlug, 80); useHome.getState().refresh(); }} />
          </View>
        </Pressable>
      </Modal>

      {/* Link confirm */}
      <Modal visible={pendingLink !== null} transparent animationType="fade" onRequestClose={() => setPendingLink(null)}>
        <Pressable style={[styles.overlay, { justifyContent: 'flex-end' }]} onPress={() => setPendingLink(null)} accessibilityLabel="Close" accessibilityRole="button">
          <Pressable style={[styles.linkSheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => undefined}>
            <Text style={styles.linkTitle}>Open link?</Text>
            <Text style={styles.linkDomain}>{pendingLink ? domainOf(pendingLink) : ''}</Text>
            <Text style={styles.linkUrl} numberOfLines={3}>
              {pendingLink}
            </Text>
            <View style={{ gap: 10, marginTop: 14 }}>
              <Button title="Open" onPress={() => void confirmOpenLink()} style={{ height: 50 }} />
              <Button title="Cancel" variant="secondary" onPress={() => setPendingLink(null)} style={{ height: 50 }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Select text */}
      <Modal visible={selectText !== null} transparent animationType="slide" onRequestClose={() => setSelectText(null)}>
        <View style={[styles.overlay, { justifyContent: 'flex-end' }]}>
          <View style={[styles.linkSheet, { maxHeight: '75%', paddingBottom: insets.bottom + 16 }]}>
            <ScrollView>
              <Text selectable style={styles.selectable}>
                {selectText}
              </Text>
            </ScrollView>
            <Button title="Done" onPress={() => setSelectText(null)} style={{ height: 50, marginTop: 12 }} />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  header: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 14, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48 },
  namePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    maxWidth: '62%',
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 22,
    backgroundColor: theme.colors.circle,
  },
  nameText: { fontSize: theme.fontSizes.body, fontWeight: '600', color: theme.colors.text, flexShrink: 1 },
  mutedTag: { fontSize: theme.fontSizes.xs, color: theme.colors.faint },
  ellipsis: { fontSize: 15, letterSpacing: 1, color: theme.colors.text, fontWeight: '700' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: theme.colors.circle,
    ...theme.shadows.circle,
  },
  searchInput: { flex: 1, fontSize: theme.fontSizes.base, color: theme.colors.text, padding: 0 },
  searchCount: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  speakPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: theme.colors.pill,
  },
  speakText: { color: theme.colors.pillText, fontWeight: '600', fontSize: theme.fontSizes.sm },
  jump: {
    position: 'absolute',
    right: 16,
    bottom: 96,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    minWidth: 38,
    paddingHorizontal: 11,
    borderRadius: 19,
    backgroundColor: theme.colors.circle,
    justifyContent: 'center',
  },
  jumpText: { fontSize: theme.fontSizes.sm, fontWeight: '700', color: theme.colors.text },
  errorBanner: {
    marginHorizontal: 14,
    marginBottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: theme.colors.dangerBg,
    borderRadius: theme.radii.card,
    padding: 10,
  },
  errorText: { flex: 1, color: theme.colors.danger, fontSize: theme.fontSizes.sm },
  overlay: { flex: 1, backgroundColor: theme.colors.overlay, justifyContent: 'center' },
  menuCol: { alignItems: 'center', gap: 12, paddingHorizontal: 24 },
  emojiBar: { flexDirection: 'row', gap: 4, backgroundColor: theme.colors.circle, borderRadius: 30, padding: 6 },
  emojiBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24 },
  menuCard: { backgroundColor: theme.colors.circle, borderRadius: 22, paddingVertical: 6, paddingHorizontal: 6, minWidth: 250 },
  selIcon: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  linkSheet: { backgroundColor: theme.colors.background, borderTopLeftRadius: theme.radii.sheet, borderTopRightRadius: theme.radii.sheet, padding: 20 },
  linkTitle: { fontSize: theme.fontSizes.xl, fontWeight: '600', color: theme.colors.text },
  linkDomain: { fontSize: theme.fontSizes.body, color: theme.colors.text, marginTop: 6, fontWeight: '500' },
  linkUrl: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 4 },
  selectable: { fontSize: theme.fontSizes.body, lineHeight: 23, color: theme.colors.text },
});
