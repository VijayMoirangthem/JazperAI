import { TouchableOpacity, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import React from 'react';
import { Text } from './Text';
import { theme } from '@/theme/tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

const variantStyles: Record<ButtonVariant, { background: string; text: string; border?: string }> = {
  primary: { background: theme.colors.pill, text: theme.colors.pillText },
  secondary: { background: theme.colors.pillSecondary, text: theme.colors.text },
  danger: { background: theme.colors.danger, text: '#ffffff' },
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const { background, text: textColor, border } = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.8}
      style={StyleSheet.flatten([styles.container, { backgroundColor: isDisabled ? theme.colors.chipBg : background, borderColor: border }, style]) ?? undefined}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <Text variant="body" style={StyleSheet.flatten([styles.loadingText, { color: textColor }, textStyle]) ?? undefined}>
          Loading...
        </Text>
      ) : (
        <Text variant="body" style={StyleSheet.flatten([styles.text, { color: textColor }, textStyle]) ?? undefined}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 44,
    borderRadius: theme.radii.pill,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  text: {
    fontWeight: '600',
  },
  loadingText: {
    fontWeight: '600',
  },
});

export default Button;