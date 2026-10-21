import { View, StyleSheet, ViewStyle } from 'react-native';
import React from 'react';
import { theme } from '@/theme/tokens';

interface DividerProps {
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Divider({ style, accessibilityLabel }: DividerProps) {
  return (
    <View
      style={StyleSheet.flatten([styles.container, style])}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="separator"
    />
  );
}

const styles = StyleSheet.create({
  container: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.md,
  },
});

export default Divider;