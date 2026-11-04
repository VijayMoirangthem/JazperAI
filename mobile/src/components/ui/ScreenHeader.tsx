import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { CircleButton } from '@/components/ui/kit';
import { theme } from '@/theme/tokens';

/** Back circle and title for plain stack screens (there is no tab bar any more). */
export function ScreenHeader({ title }: { title: string }) {
  const router = useRouter();
  return (
    <View style={styles.row}>
      <CircleButton label="Back" onPress={() => router.back()}>
        <ChevronLeft size={22} color={theme.colors.text} />
      </CircleButton>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  title: { fontSize: theme.fontSizes.xl, fontWeight: '600', color: theme.colors.text },
});
