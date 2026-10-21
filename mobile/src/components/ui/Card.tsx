import { View, StyleSheet, ViewStyle } from 'react-native';
import React from 'react';
import { theme } from '@/theme/tokens';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
  padding?: keyof typeof theme.spacing;
}

export function Card({ children, style, accessibilityLabel, padding = 'lg' }: CardProps) {
  return (
    <View
      style={StyleSheet.flatten([styles.container, { padding: theme.spacing[padding] }, style])}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="group"
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
});

export default Card;