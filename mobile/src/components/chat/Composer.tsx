import { View, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import React from 'react';
import { Text } from '@/components/ui';
import { theme } from '@/theme/tokens';

export interface ComposerProps {
  text: string;
  onChangeText: (text: string) => void;
  streaming: boolean;
  onSend: () => void;
  onStop: () => void;
  placeholder?: string;
}

export function Composer({
  text,
  onChangeText,
  streaming,
  onSend,
  onStop,
  placeholder = 'Message',
}: ComposerProps) {
  const canSend = text.trim().length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.pill}>
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
});
