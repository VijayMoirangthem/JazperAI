import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import React from 'react';
import { InlinePart, MarkdownBlock, parseMarkdown } from '@/utils/markdown';
import { theme } from '@/theme/tokens';

interface MarkdownLiteProps {
  text: string;
  onPressLink?: (url: string) => void;
  onCopyCode?: (code: string) => void;
}

function renderInline(parts: InlinePart[], onPressLink?: (url: string) => void): React.ReactNode[] {
  return parts.map((part, index) => {
    const key = `${part.type}-${index}`;
    if (part.type === 'bold') {
      return (
        <Text key={key} style={styles.bold}>
          {part.text}
        </Text>
      );
    }
    if (part.type === 'code') {
      return (
        <Text key={key} style={styles.inlineCode}>
          {part.text}
        </Text>
      );
    }
    if (part.type === 'link') {
      return (
        <Text
          key={key}
          style={styles.link}
          accessibilityRole="link"
          onPress={() => onPressLink?.(part.url)}
        >
          {part.text}
        </Text>
      );
    }
    return <Text key={key}>{part.text}</Text>;
  });
}

function renderBlock(
  block: MarkdownBlock,
  key: string,
  onPressLink?: (url: string) => void,
  onCopyCode?: (code: string) => void
): React.ReactNode {
  if (block.type === 'code') {
    return (
      <View key={key} style={styles.codeBlock}>
        <Text style={styles.code}>{block.code}</Text>
        {onCopyCode ? (
          <TouchableOpacity
            style={styles.copyButton}
            onPress={() => onCopyCode(block.code)}
            accessibilityRole="button"
            accessibilityLabel="Copy code"
          >
            <Text style={styles.copyLabel}>Copy</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  }

  if (block.type === 'bullets') {
    return (
      <View key={key} style={styles.bulletList}>
        {block.items.map((item, index) => (
          <View key={`bullet-${index}`} style={styles.bulletRow}>
            <Text style={styles.bulletMark}>•</Text>
            <Text style={styles.bulletText}>{renderInline(item, onPressLink)}</Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <Text key={key} style={styles.paragraph}>
      {renderInline(block.parts, onPressLink)}
    </Text>
  );
}

export function MarkdownLite({ text, onPressLink, onCopyCode }: MarkdownLiteProps) {
  const blocks = parseMarkdown(text);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <View>
      {blocks.map((block, index) => renderBlock(block, `${block.type}-${index}`, onPressLink, onCopyCode))}
    </View>
  );
}

const styles = StyleSheet.create({
  paragraph: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    lineHeight: 21,
  },
  bold: {
    fontWeight: '700',
  },
  inlineCode: {
    fontFamily: 'monospace',
    backgroundColor: theme.colors.border,
    borderRadius: 4,
  },
  link: {
    color: theme.colors.accent,
    textDecorationLine: 'underline',
  },
  codeBlock: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.button,
    padding: 10,
    marginVertical: 4,
  },
  code: {
    color: theme.colors.text,
    fontFamily: 'monospace',
    fontSize: theme.fontSizes.sm,
  },
  copyButton: {
    alignSelf: 'flex-end',
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.raised,
  },
  copyLabel: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.xs,
  },
  bulletList: {
    marginVertical: 2,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  bulletMark: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    lineHeight: 21,
  },
  bulletText: {
    flex: 1,
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    lineHeight: 21,
  },
});
