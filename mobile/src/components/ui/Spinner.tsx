import { ActivityIndicator, ViewStyle } from 'react-native';
import React from 'react';
import { theme } from '@/theme/tokens';

interface SpinnerProps {
  size?: 'small' | 'large';
  color?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Spinner({ size = 'large', color = theme.colors.accent, style, accessibilityLabel }: SpinnerProps) {
  return (
    <ActivityIndicator
      size={size}
      color={color}
      style={style}
      accessibilityLabel={accessibilityLabel ?? 'Loading'}
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
    />
  );
}

export default Spinner;