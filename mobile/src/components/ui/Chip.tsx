import { TouchableOpacity, View, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import React from 'react';
import { Text } from './Text';
import { theme } from '@/theme/tokens';

interface ChipProps {
  children: React.ReactNode;
  onPress?: () => void;
  selected?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'tab';
}

export function Chip({
  children,
  onPress,
  selected = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityRole = 'button',
}: ChipProps) {
  const content = (
    <Text variant="caption" style={StyleSheet.flatten([{ color: selected ? '#ffffff' : theme.colors.text }, textStyle]) ?? undefined}>
      {children}
    </Text>
  );

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.8}
        style={StyleSheet.flatten([styles.container, selected && styles.selected, style]) ?? undefined}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={{ selected }}
      >
        {content}
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={StyleSheet.flatten([styles.container, selected && styles.selected, style]) ?? undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ selected }}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.raised,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  selected: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
});

export default Chip;