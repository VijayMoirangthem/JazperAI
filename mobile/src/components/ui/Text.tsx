import { Text as RNText, StyleSheet, TextStyle } from 'react-native';
import React from 'react';
import { theme } from '@/theme/tokens';

export type TextVariant = 'title' | 'body' | 'muted' | 'caption';

interface TextProps {
  children: React.ReactNode;
  variant?: TextVariant;
  style?: TextStyle;
  accessibilityLabel?: string;
  numberOfLines?: number;
}

const variantStyles: Record<TextVariant, TextStyle> = {
  title: {
    fontSize: theme.fontSizes.title,
    fontWeight: '600',
    color: theme.colors.text,
  },
  body: {
    fontSize: theme.fontSizes.base,
    color: theme.colors.text,
  },
  muted: {
    fontSize: theme.fontSizes.base,
    color: theme.colors.muted,
  },
  caption: {
    fontSize: theme.fontSizes.xs,
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
};

export function Text({
  children,
  variant = 'body',
  style,
  accessibilityLabel,
  numberOfLines,
}: TextProps) {
  return (
    <RNText
      style={StyleSheet.flatten([variantStyles[variant], style])}
      accessibilityLabel={accessibilityLabel}
      numberOfLines={numberOfLines}
    >
      {children}
    </RNText>
  );
}

export default Text;