/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, Href } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { ClusterItem, MascotCluster } from '@/components/MascotExtras';
import { getAuthProvider } from '@/auth/AuthProvider';
import { BRAND } from '@/config';
import { MASCOT_PALETTE } from '@/theme/tokens';
import { theme } from '@/theme/tokens';

// Ten mascots around the edges. x/y are the centre as a fraction of the screen, so some are cut off.
const CLUSTER: ClusterItem[] = [
  { key: 'w1', body: 'cloud', color: MASCOT_PALETTE.green, size: 64, x: 0.38, y: 0.14, rotate: -6, drift: 1, delay: 100 },
  { key: 'w2', body: 'blob', color: MASCOT_PALETTE.pink, size: 56, x: 0.78, y: 0.16, rotate: 8, drift: 2, delay: 180 },
  { key: 'w3', body: 'drop', color: MASCOT_PALETTE.purple, size: 52, x: 0.06, y: 0.31, rotate: -10, drift: 3, delay: 260 },
  { key: 'w4', body: 'circle', color: MASCOT_PALETTE.brown, size: 60, x: 0.97, y: 0.32, rotate: 12, drift: 2, delay: 340 },
  { key: 'w5', body: 'circle', color: MASCOT_PALETTE.orange, size: 78, x: 0.0, y: 0.5, rotate: 0, drift: 1, delay: 420 },
  { key: 'w6', body: 'drop', color: MASCOT_PALETTE.red, size: 70, x: 1.0, y: 0.54, rotate: -8, drift: 3, delay: 500 },
  { key: 'w7', body: 'squircle', color: MASCOT_PALETTE.blue, size: 62, x: 0.14, y: 0.72, rotate: 6, drift: 2, delay: 580 },
  { key: 'w8', body: 'hexagon', color: MASCOT_PALETTE.orange, size: 76, x: 0.5, y: 0.76, rotate: -4, drift: 1, delay: 660 },
  { key: 'w9', body: 'circle', color: MASCOT_PALETTE.teal, size: 52, x: 0.82, y: 0.7, rotate: 10, drift: 3, delay: 740 },
  { key: 'w10', body: 'star', color: MASCOT_PALETTE.amber, size: 44, x: 0.66, y: 0.1, rotate: 0, drift: 2, delay: 820 },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => undefined);
  }, []);

  const items = useMemo(() => CLUSTER, []);

  const signIn = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await getAuthProvider().signIn();
      router.replace('/(tabs)/chats' as Href);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <MascotCluster items={items} still={still} />

      <View style={styles.center}>
        <Animated.Text entering={still ? undefined : FadeInUp.delay(200).duration(500)} style={styles.wordmark} accessibilityRole="header">
          {BRAND.name}
        </Animated.Text>
        <Animated.Text entering={still ? undefined : FadeInUp.delay(320).duration(500)} style={styles.tagline}>
          {BRAND.tagline}
        </Animated.Text>
        {failed ? (
          <View style={styles.errorBox} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={styles.errorText}>Can't reach Jasper right now. If you are away from your computer, connect with the QR code.</Text>
            <Pressable onPress={signIn} accessibilityRole="button" accessibilityLabel="Try again" hitSlop={10}>
              <Text style={styles.link}>Try again</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/(auth)/pair' as Href)} style={styles.qrButton} accessibilityRole="button" accessibilityLabel="Connect with QR code">
              <Text style={styles.qrButtonText}>Connect with QR code</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Animated.View entering={still ? undefined : FadeInDown.delay(500).duration(500)} style={[styles.bottom, { paddingBottom: insets.bottom + 18 }]}>
        <Pressable
          onPress={signIn}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          accessibilityState={{ busy, disabled: busy }}
          style={({ pressed }) => [styles.button, theme.shadows.composer, { transform: [{ scale: pressed ? 0.98 : 1 }], opacity: busy ? 0.85 : 1 }]}
        >
          <Text style={styles.buttonText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 30 },
  wordmark: { fontSize: 38, fontWeight: '500', color: theme.colors.text, letterSpacing: -0.5 },
  tagline: { marginTop: 10, fontSize: theme.fontSizes.base, lineHeight: 21, textAlign: 'center', color: theme.colors.muted, maxWidth: 260 },
  errorBox: { marginTop: 22, alignItems: 'center', gap: 10 },
  errorText: { color: theme.colors.danger, fontSize: theme.fontSizes.sm, textAlign: 'center' },
  link: { color: theme.colors.text, fontWeight: '600', fontSize: theme.fontSizes.base },
  linkMuted: { color: theme.colors.muted, fontSize: theme.fontSizes.sm },
  qrButton: { height: 44, paddingHorizontal: 22, borderRadius: 22, backgroundColor: theme.colors.pillSecondary, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  qrButtonText: { color: theme.colors.text, fontWeight: '600', fontSize: theme.fontSizes.base },
  bottom: { paddingHorizontal: 20 },
  button: {
    height: 52,
    borderRadius: 26,
    backgroundColor: theme.colors.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: theme.colors.pillText, fontSize: theme.fontSizes.body, fontWeight: '600' },
});
