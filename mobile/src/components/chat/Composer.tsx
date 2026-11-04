/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useEffect, useRef, useState } from 'react';
import { Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowUp, Camera, FileText, Image as ImageIcon, Mic, Plus, Square, Trash2, X } from 'lucide-react-native';
import { Attachment } from '@/api/types';
import { isImageAttachment } from '@/utils/attachments';
import { formatDuration } from '@/utils/format';
import { CircleButton } from '@/components/ui/kit';
import { theme } from '@/theme/tokens';

export interface ComposerProps {
  text: string;
  onChangeText: (text: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  placeholder: string;
  attachments: Attachment[];
  onAddFromCamera: () => void;
  onAddFromGallery: () => void;
  onAddFromFiles: () => void;
  onRemoveAttachment: (index: number) => void;
  recording: boolean;
  recordingSeconds: number;
  recordingLevel: number;
  transcribing: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onCancelRecording: () => void;
  voiceError: string | null;
  onDismissVoiceError: () => void;
  quote: string | null;
  onClearQuote: () => void;
  offline?: boolean;
}

const BARS = 28;

function Waveform({ level }: { level: number }) {
  const history = useRef<number[]>(Array.from({ length: BARS }, () => 0.08));
  const [, force] = useState(0);
  useEffect(() => {
    history.current = [...history.current.slice(1), Math.max(0.08, level)];
    force((n) => n + 1);
  }, [level]);
  return (
    <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {history.current.map((v, i) => (
        <View key={i} style={[styles.bar, { height: 4 + v * 26 }]} />
      ))}
    </View>
  );
}

export function Composer(props: ComposerProps) {
  const {
    text,
    onChangeText,
    streaming,
    onSend,
    onStop,
    placeholder,
    attachments,
    recording,
    recordingSeconds,
    recordingLevel,
    transcribing,
    voiceError,
  } = props;
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState(false);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const pick = (action: () => void) => () => {
    setMenu(false);
    action();
  };

  return (
    <View style={[styles.wrap, { paddingBottom: keyboard ? 8 : insets.bottom + 8 }]}>
      {menu ? (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenu(false)} accessibilityLabel="Close menu" accessibilityRole="button" />
          <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)} style={[styles.menu, theme.shadows.composer]}>
            {[
              { label: 'Camera', icon: <Camera size={20} color={theme.colors.text} />, action: props.onAddFromCamera },
              { label: 'Photo library', icon: <ImageIcon size={20} color={theme.colors.text} />, action: props.onAddFromGallery },
              { label: 'File', icon: <FileText size={20} color={theme.colors.text} />, action: props.onAddFromFiles },
            ].map((item) => (
              <Pressable key={item.label} onPress={pick(item.action)} style={({ pressed }) => [styles.menuRow, pressed && { backgroundColor: theme.colors.chipBg }]} accessibilityRole="button" accessibilityLabel={item.label}>
                {item.icon}
                <Text style={styles.menuText}>{item.label}</Text>
              </Pressable>
            ))}
          </Animated.View>
        </>
      ) : null}

      {props.quote ? (
        <View style={styles.quote}>
          <View style={styles.quoteBar} />
          <Text style={styles.quoteText} numberOfLines={2}>
            {props.quote}
          </Text>
          <Pressable onPress={props.onClearQuote} accessibilityRole="button" accessibilityLabel="Remove quote" hitSlop={10}>
            <X size={16} color={theme.colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {attachments.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachRow} keyboardShouldPersistTaps="handled">
          {attachments.map((attachment, index) => (
            <View key={`${attachment.name}-${index}`} style={styles.attachItem}>
              {isImageAttachment(attachment) ? (
                <Image source={{ uri: attachment.uri }} style={styles.attachThumb} accessibilityLabel={`Image ${attachment.name}`} />
              ) : (
                <View style={styles.attachFile}>
                  <FileText size={16} color={theme.colors.muted} />
                  <Text style={styles.attachName} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                </View>
              )}
              <Pressable onPress={() => props.onRemoveAttachment(index)} style={styles.attachRemove} accessibilityRole="button" accessibilityLabel={`Remove ${attachment.name}`} hitSlop={8}>
                <X size={12} color="#ffffff" />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      {props.offline ? <Text style={styles.offline}>Will send when you're back online</Text> : null}
      {voiceError ? (
        <Pressable onPress={props.onDismissVoiceError} accessibilityRole="alert" accessibilityLabel="Dismiss voice error">
          <Text style={styles.voiceError}>{voiceError}</Text>
        </Pressable>
      ) : null}

      {recording ? (
        <Animated.View entering={FadeIn.duration(140)} style={styles.line}>
          <CircleButton label="Cancel recording" onPress={props.onCancelRecording} tone="grey">
            <Trash2 size={19} color={theme.colors.text} />
          </CircleButton>
          <View style={[styles.pill, styles.recordPill, theme.shadows.composer]}>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>{formatDuration(recordingSeconds)}</Text>
            <Waveform level={recordingLevel} />
          </View>
          <CircleButton label="Finish recording" onPress={props.onStopRecording} tone="black">
            <ArrowUp size={20} color={theme.colors.pillText} />
          </CircleButton>
        </Animated.View>
      ) : (
        <View style={styles.line}>
          <CircleButton label="Add attachment" onPress={() => setMenu((v) => !v)}>
            <Plus size={22} color={theme.colors.text} />
          </CircleButton>
          <Animated.View layout={LinearTransition.duration(140)} style={[styles.pill, theme.shadows.composer]}>
            <TextInput
              value={text}
              onChangeText={onChangeText}
              placeholder={placeholder}
              placeholderTextColor={theme.colors.faint}
              multiline
              style={styles.input}
              accessibilityLabel={placeholder}
              maxFontSizeMultiplier={1.4}
              textAlignVertical="center"
            />
            {streaming ? (
              <CircleButton label="Stop" onPress={onStop} tone="black" size={36}>
                <Square size={13} color={theme.colors.pillText} fill={theme.colors.pillText} />
              </CircleButton>
            ) : hasContent ? (
              <CircleButton label="Send" onPress={onSend} tone="black" size={36}>
                <ArrowUp size={19} color={theme.colors.pillText} />
              </CircleButton>
            ) : (
              <CircleButton label={transcribing ? 'Transcribing' : 'Record a voice note'} onPress={props.onStartRecording} tone="grey" size={36} disabled={transcribing}>
                {transcribing ? <Text style={styles.dots}>···</Text> : <Mic size={18} color={theme.colors.muted} />}
              </CircleButton>
            )}
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, backgroundColor: 'transparent', gap: 8 },
  line: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  pill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: theme.colors.composer,
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 4,
    minHeight: 44,
  },
  input: { flex: 1, maxHeight: 140, fontSize: theme.fontSizes.body, color: theme.colors.text, paddingTop: 8, paddingBottom: 8, paddingRight: 8 },
  recordPill: { alignItems: 'center', gap: 10, height: 44, paddingVertical: 0, paddingRight: 14 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: theme.colors.danger },
  recTime: { fontSize: theme.fontSizes.base, color: theme.colors.text, fontVariant: ['tabular-nums'], width: 40 },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 34 },
  bar: { width: 3, borderRadius: 2, backgroundColor: theme.colors.muted },
  dots: { fontSize: 18, color: theme.colors.muted, fontWeight: '700' },
  menuBackdrop: { position: 'absolute', top: -2000, bottom: 0, left: 0, right: 0 },
  menu: { position: 'absolute', left: 12, bottom: 70, backgroundColor: theme.colors.circle, borderRadius: 18, paddingVertical: 6, minWidth: 190, zIndex: 20 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, height: 48 },
  menuText: { fontSize: theme.fontSizes.body, color: theme.colors.text },
  quote: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.colors.chipBg, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  quoteBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, backgroundColor: theme.colors.muted },
  quoteText: { flex: 1, fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  attachRow: { gap: 10, paddingVertical: 2, paddingRight: 8 },
  attachItem: { position: 'relative' },
  attachThumb: { width: 64, height: 64, borderRadius: 14 },
  attachFile: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, maxWidth: 170, paddingHorizontal: 12, borderRadius: 14, backgroundColor: theme.colors.chipBg, marginTop: 10 },
  attachName: { fontSize: theme.fontSizes.sm, color: theme.colors.text, flexShrink: 1 },
  attachRemove: { position: 'absolute', top: -4, right: -4, width: 20, height: 20, borderRadius: 10, backgroundColor: '#6b6b6b', alignItems: 'center', justifyContent: 'center' },
  offline: { fontSize: theme.fontSizes.xs, color: theme.colors.faint, textAlign: 'center' },
  voiceError: { fontSize: theme.fontSizes.sm, color: theme.colors.danger, textAlign: 'center' },
});
