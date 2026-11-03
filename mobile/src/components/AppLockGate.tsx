/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { Lock } from 'lucide-react-native';
import { useSettings } from '@/store/settings';
import { useAuth } from '@/auth/useAuth';
import { theme } from '@/theme/tokens';

const LOCK_AFTER_MS = 2 * 60 * 1000;

/** Covers the app until the user passes the fingerprint/face prompt. Active only when "App lock" is on. */
export function AppLockGate() {
  const enabled = useSettings((s) => s.appLock);
  const signedIn = useAuth((s) => !!s.credentials);
  const [locked, setLocked] = useState(false);
  const backgroundAt = useRef<number | null>(null);
  const started = useRef(false);

  const unlock = useCallback(async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Jasper', cancelLabel: 'Cancel' });
      if (result.success) setLocked(false);
    } catch {
      // Stay locked.
    }
  }, []);

  // Lock once when the app opens.
  useEffect(() => {
    if (enabled && signedIn && !started.current) {
      started.current = true;
      setLocked(true);
      void unlock();
    }
    if (!enabled) {
      setLocked(false);
      started.current = false;
    }
  }, [enabled, signedIn, unlock]);

  // Lock again after two minutes in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundAt.current = Date.now();
      if (state === 'active' && backgroundAt.current && enabled) {
        if (Date.now() - backgroundAt.current > LOCK_AFTER_MS) {
          setLocked(true);
          void unlock();
        }
        backgroundAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled, unlock]);

  if (!locked) return null;
  return (
    <View style={styles.cover} accessibilityViewIsModal>
      <Lock size={34} color={theme.colors.muted} />
      <Text style={styles.title}>Jasper is locked</Text>
      <Pressable onPress={unlock} style={styles.button} accessibilityRole="button" accessibilityLabel="Unlock">
        <Text style={styles.buttonText}>Unlock</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFill, backgroundColor: theme.colors.background, alignItems: 'center', justifyContent: 'center', gap: 16, zIndex: 100 },
  title: { fontSize: theme.fontSizes.xl, fontWeight: '600', color: theme.colors.text },
  button: { height: 48, paddingHorizontal: 36, borderRadius: 24, backgroundColor: theme.colors.pill, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: theme.colors.pillText, fontWeight: '600', fontSize: theme.fontSizes.body },
});
