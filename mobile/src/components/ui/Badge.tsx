import { View, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import React from 'react';
import { Text } from './Text';
import { theme } from '@/theme/tokens';

export type BadgeScore = number | null;

interface BadgeProps {
  score: BadgeScore;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
}

export function Badge({ score, style, textStyle, accessibilityLabel }: BadgeProps) {
  const { bg, text } = getScoreColors(score);
  const label = score === null ? 'new' : `${score}`;

  const containerStyle: ViewStyle = {
    ...styles.container,
    backgroundColor: bg,
    ...style,
  };

  const textStyleCombined: TextStyle = {
    color: text,
    fontWeight: '600',
    ...textStyle,
  };

  return (
    <View
      style={containerStyle}
      accessibilityLabel={accessibilityLabel ?? `Score: ${label}`}
      accessibilityRole="status"
    >
      <Text variant="caption" style={textStyleCombined}>
        {label}
      </Text>
    </View>
  );
}

function getScoreColors(score: BadgeScore): { bg: string; text: string } {
  if (score === null) {
    return { bg: theme.colors.border, text: theme.colors.muted };
  }
  if (score >= 80) {
    return { bg: theme.colors.success, text: '#ffffff' };
  }
  if (score >= 60) {
    return { bg: theme.colors.warning, text: '#000000' };
  }
  return { bg: theme.colors.danger, text: '#ffffff' };
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radii.pill,
    minWidth: 36,
    alignItems: 'center',
  },
});

export default Badge;