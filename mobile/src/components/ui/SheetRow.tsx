import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/theme/tokens';

interface SheetRowProps {
  label: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  right?: React.ReactNode;
  subtitle?: string;
}

/** One tappable row inside a sheet: icon, label, optional subtitle and trailing element. */
export function SheetRow({ label, icon, onPress, danger, right, subtitle }: SheetRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.colors.chipBg }]}
    >
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={styles.body}>
        <Text style={[styles.label, danger && { color: theme.colors.danger }]} maxFontSizeMultiplier={1.4}>
          {label}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingHorizontal: 8, gap: 14, borderRadius: 14 },
  icon: { width: 28, alignItems: 'center' },
  body: { flex: 1 },
  label: { fontSize: theme.fontSizes.body, color: theme.colors.text, fontWeight: '500' },
  subtitle: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 2 },
});
