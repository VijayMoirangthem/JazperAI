import { Switch as RNSSwitch, StyleSheet, ViewStyle } from 'react-native';
import React from 'react';
import { theme } from '@/theme/tokens';

interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: ViewStyle;
  trackColor?: { false?: string; true?: string };
  thumbColor?: string;
  accessibilityLabel?: string;
}

export function Switch({
  value,
  onValueChange,
  disabled = false,
  style,
  trackColor = { false: theme.colors.border, true: theme.colors.accent },
  thumbColor = theme.colors.text,
  accessibilityLabel,
}: SwitchProps) {
  return (
    <RNSSwitch
      value={value}
      onValueChange={onValueChange}
      disabled={disabled}
      trackColor={trackColor}
      thumbColor={value ? thumbColor : theme.colors.border}
      style={style}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
    />
  );
}

export default Switch;