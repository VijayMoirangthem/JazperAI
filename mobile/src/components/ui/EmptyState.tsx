import { View, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import React from 'react';
import { Text } from './Text';
import { Button } from './Button';
import { theme } from '@/theme/tokens';

interface EmptyStateProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: ViewStyle;
  titleStyle?: TextStyle;
  subtitleStyle?: TextStyle;
  accessibilityLabel?: string;
}

export function EmptyState({
  title,
  subtitle,
  actionLabel,
  onAction,
  style,
  titleStyle,
  subtitleStyle,
  accessibilityLabel,
}: EmptyStateProps) {
  return (
    <View
      style={StyleSheet.flatten([styles.container, style]) ?? undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="region"
    >
      <Text variant="title" style={StyleSheet.flatten([styles.title, titleStyle]) ?? undefined}>
        {title}
      </Text>
      {subtitle && (
        <Text variant="muted" style={StyleSheet.flatten([styles.subtitle, subtitleStyle]) ?? undefined}>
          {subtitle}
        </Text>
      )}
      {actionLabel && onAction && (
        <Button
          title={actionLabel}
          onPress={onAction}
          variant="primary"
          style={styles.actionButton}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
  },
  title: {
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
    lineHeight: 22,
  },
  actionButton: {
    marginTop: theme.spacing.md,
  },
});

export default EmptyState;