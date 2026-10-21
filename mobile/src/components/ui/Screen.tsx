import { SafeAreaView, StyleSheet, ViewStyle } from 'react-native';
import React from 'react';
import { theme } from '@/theme/tokens';

interface ScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Screen({ children, style, accessibilityLabel }: ScreenProps) {
  return (
    <SafeAreaView
      style={StyleSheet.flatten([{ flex: 1, backgroundColor: theme.colors.background }, style])}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="region"
    >
      {children}
    </SafeAreaView>
  );
}

export default Screen;