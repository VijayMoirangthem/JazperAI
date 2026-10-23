import { StyleSheet, TouchableOpacity, View } from 'react-native';
import React from 'react';
import { Text } from '@/components/ui';
import { useSystem } from '@/store/system';
import { theme } from '@/theme/tokens';

const ACCENTS = {
  offline: theme.colors.warning,
  unpaired: theme.colors.danger,
  'rate-limited': theme.colors.warning,
} as const;

export function SystemBanner() {
  const banner = useSystem((state) => state.banner);
  const dismiss = useSystem((state) => state.dismissBanner);

  if (!banner) return null;

  const accent = ACCENTS[banner.kind];

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View
        style={[styles.banner, { borderColor: accent }]}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        accessibilityLabel={`${banner.title}. ${banner.body}`}
      >
        <View style={[styles.stripe, { backgroundColor: accent }]} />
        <View style={styles.copy}>
          <Text style={styles.title}>{banner.title}</Text>
          <Text style={styles.body}>{banner.body}</Text>
        </View>
        <TouchableOpacity
          onPress={dismiss}
          style={styles.dismiss}
          accessibilityRole="button"
          accessibilityLabel="Dismiss alert"
        >
          <Text style={styles.dismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 56,
    left: theme.spacing.md,
    right: theme.spacing.md,
    zIndex: 20,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.card,
    borderWidth: 1,
    paddingRight: theme.spacing.md,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  stripe: {
    width: 4,
    alignSelf: 'stretch',
  },
  copy: {
    flex: 1,
    paddingVertical: theme.spacing.md,
    gap: 2,
  },
  title: {
    color: theme.colors.text,
    fontSize: theme.fontSizes.base,
    fontWeight: '600',
  },
  body: {
    color: theme.colors.muted,
    fontSize: theme.fontSizes.sm,
  },
  dismiss: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
  },
  dismissText: {
    color: theme.colors.accent,
    fontSize: theme.fontSizes.sm,
    fontWeight: '600',
  },
});
