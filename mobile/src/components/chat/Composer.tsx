import { View, StyleSheet, TouchableOpacity, TextInput, Image } from 'react-native';
import React, { useState } from 'react';
import { Attachment } from '@/api/types';
import { Button, SheetModal, Spinner, Text } from '@/components/ui';
import { isImageAttachment } from '@/utils/attachments';
import { theme } from '@/theme/tokens';

export interface ComposerProps {
  text: string;
  onChangeText: (text: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  placeholder?: string;
  attachments?: Attachment[];
  onAddFromCamera?: () => void;
  onAddFromGallery?: () => void;
  onAddFromFiles?: () => void;
  onRemoveAttachment?: (index: number) => void;
  recording?: boolean;
  recordingSeconds?: number;
  transcribing?: boolean;
  onStartRecording?: () => void;
  onStopRecording?: () => void;
  onCancelRecording?: () => void;
  voiceError?: string | null;
  onDismissVoiceError?: () => void;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function Composer({
  text,
  onChangeText,
  streaming,
  onSend,
  onStop,
  placeholder = 'Message',
  attachments = [],
  onAddFromCamera,
  onAddFromGallery,
  onAddFromFiles,
  onRemoveAttachment,
  recording = false,
  recordingSeconds = 0,
  transcribing = false,
  onStartRecording,
  onStopRecording,
  onCancelRecording,
  voiceError = null,
  onDismissVoiceError,
}: ComposerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const canSend = text.trim().length > 0 || attachments.length > 0;

  const pick = (action?: () => void) => {
    setMenuOpen(false);
    action?.();
  };

  return (
    <View style={styles.container}>
      {attachments.length > 0 ? (
        <View style={styles.attachments}>
          {attachments.map((attachment, index) => (
            <View key={`${attachment.name}-${index}`} style={styles.attachmentChip}>
              {isImageAttachment(attachment) ? (
                <Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} />
              ) : null}
              <Text style={styles.attachmentName} numberOfLines={1}>
                {attachment.name}
              </Text>
              <TouchableOpacity
                onPress={() => onRemoveAttachment?.(index)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${attachment.name}`}
              >
                <Text style={styles.removeIcon}>{'\u2715'}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {voiceError ? (
        <View style={styles.voiceError}>
          <Text style={styles.voiceErrorText}>{voiceError}</Text>
          {onDismissVoiceError ? (
            <TouchableOpacity onPress={onDismissVoiceError} accessibilityRole="button" accessibilityLabel="Dismiss voice error">
              <Text style={styles.removeIcon}>{'\u2715'}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {recording ? (
        <View style={styles.recordingBar}>
          <View style={styles.recordingDot} />
          <Text style={styles.timer}>{formatDuration(recordingSeconds)}</Text>
          <View style={styles.recordingActions}>
            <Button title="Cancel" variant="secondary" onPress={onCancelRecording} style={styles.recordingButton} />
            <Button
              title="Stop"
              onPress={onStopRecording}
              loading={transcribing}
              style={styles.recordingButton}
            />
          </View>
        </View>
      ) : (
        <View style={styles.pill}>
          <TouchableOpacity
            style={styles.iconButton}
            onPress={() => setMenuOpen(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add attachment"
          >
            <Text style={styles.plusIcon}>+</Text>
          </TouchableOpacity>

          <TextInput
            style={styles.input}
            value={text}
            onChangeText={onChangeText}
            placeholder={placeholder}
            placeholderTextColor={theme.colors.muted}
            multiline
            maxLength={4000}
            accessibilityLabel="Message"
          />

          <TouchableOpacity
            style={styles.iconButton}
            onPress={onStartRecording}
            disabled={transcribing}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Record voice note"
          >
            {transcribing ? (
              <Spinner size="small" color={theme.colors.muted} />
            ) : (
              <Text style={styles.micIcon}>{'\u{1F3A4}'}</Text>
            )}
          </TouchableOpacity>

          {streaming ? (
            <TouchableOpacity
              style={styles.sendButton}
              onPress={onStop}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Stop"
            >
              <Text style={styles.stopIcon}>{'\u25A0'}</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.sendButton, !canSend ? styles.sendButtonDisabled : null]}
              onPress={onSend}
              disabled={!canSend}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Send"
            >
              <Text style={styles.sendIcon}>{'\u2191'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <SheetModal
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Add attachment"
        contentStyle={styles.menu}
      >
        <Button title="Camera" variant="secondary" onPress={() => pick(onAddFromCamera)} />
        <Button title="Gallery" variant="secondary" onPress={() => pick(onAddFromGallery)} />
        <Button title="Files" variant="secondary" onPress={() => pick(onAddFromFiles)} />
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.background,
    gap: theme.spacing.sm,
  },
  attachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    maxWidth: '100%',
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.raised,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  attachmentThumb: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  attachmentName: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.xs,
    maxWidth: 160,
  },
  removeIcon: {
    color: theme.colors.muted,
    fontSize: 12,
  },
  voiceError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.button,
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  voiceErrorText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.fontSizes.xs,
  },
  recordingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    backgroundColor: theme.colors.composer,
    borderRadius: theme.radii.card,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.danger,
  },
  timer: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
  },
  recordingActions: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  recordingButton: {
    minWidth: 84,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    backgroundColor: theme.colors.composer,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  iconButton: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusIcon: {
    color: theme.colors.muted,
    fontSize: 22,
    lineHeight: 24,
  },
  micIcon: {
    fontSize: 16,
  },
  input: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    minHeight: 32,
    maxHeight: 120,
    paddingTop: 6,
    paddingBottom: 6,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
  sendIcon: {
    color: '#ffffff',
    fontSize: 16,
  },
  stopIcon: {
    color: '#ffffff',
    fontSize: 14,
  },
  menu: {
    flex: 0,
    gap: theme.spacing.sm,
  },
});
