/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/preserve-manual-memoization, react-hooks/immutability, react/no-unescaped-entities, import/namespace */
import React, { useEffect } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { create } from 'zustand';
import { theme } from '@/theme/tokens';

// CircleButton -------------------------------------------------------------------------------------------
interface CircleButtonProps {
  label: string;
  onPress?: () => void;
  children: React.ReactNode;
  size?: number;
  tone?: 'white' | 'grey' | 'black';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function CircleButton({ label, onPress, children, size = 44, tone = 'white', style, disabled }: CircleButtonProps) {
  const background =
    tone === 'black' ? theme.colors.pill : tone === 'grey' ? theme.colors.pillSecondary : theme.colors.circle;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.4 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
        tone === 'white' ? theme.shadows.circle : null,
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

// UnreadDot ----------------------------------------------------------------------------------------------
export function UnreadDot({ size = 10 }: { size?: number }) {
  return (
    <View
      accessibilityLabel="Unread"
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors.accent }}
    />
  );
}

// SectionLabel -------------------------------------------------------------------------------------------
export function SectionLabel({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text style={[styles.sectionLabel, style]} maxFontSizeMultiplier={1.4}>
      {children}
    </Text>
  );
}

// Skeleton -----------------------------------------------------------------------------------------------
export function Skeleton({ width, height, radius = 8, style }: { width: number | `${number}%`; height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0.5, { duration: 700 })), -1);
  }, [pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: radius, backgroundColor: theme.colors.chipBg }, animated, style]}
    />
  );
}

// Toast --------------------------------------------------------------------------------------------------
interface ToastState {
  message: string | null;
  id: number;
  show: (message: string) => void;
  hide: () => void;
}

export const useToast = create<ToastState>()((set, get) => ({
  message: null,
  id: 0,
  show: (message) => {
    const id = get().id + 1;
    set({ message, id });
    setTimeout(() => {
      if (get().id === id) set({ message: null });
    }, 2600);
  },
  hide: () => set({ message: null }),
}));

export function ToastHost() {
  const message = useToast((s) => s.message);
  const insets = useSafeAreaInsets();
  if (!message) return null;
  return (
    <View pointerEvents="none" style={[styles.toastWrap, { bottom: insets.bottom + 96 }]}>
      <View style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={styles.toastText}>{message}</Text>
      </View>
    </View>
  );
}

// Sheet (route based) ------------------------------------------------------------------------------------
interface SheetScreenProps {
  children: React.ReactNode;
  /** 'auto' wraps the content; 'tall' fills most of the screen. */
  height?: 'auto' | 'tall';
  onClose?: () => void;
  showHandle?: boolean;
  tint?: string;
}

const SCREEN_H = Dimensions.get('window').height;

/** A bottom sheet that lives in its own transparent route. Tap the backdrop or press back to close. */
export function SheetScreen({ children, height = 'auto', onClose, showHandle = true, tint }: SheetScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withSpring(1, { damping: 22, stiffness: 220, mass: 0.9 });
  }, [progress]);

  const close = () => {
    progress.value = withTiming(0, { duration: 160, easing: Easing.out(Easing.quad) });
    setTimeout(() => (onClose ? onClose() : router.back()), 150);
  };

  const backdrop = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 1], [0, 1]) }));
  const sheet = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(progress.value, [0, 1], [SCREEN_H * 0.5, 0]) }] }));

  return (
    <View style={styles.sheetRoot}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: theme.colors.overlay }, backdrop]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" accessibilityRole="button" />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetAvoid} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.sheet,
            theme.shadows.sheet,
            { paddingBottom: insets.bottom + 12, backgroundColor: tint ?? theme.colors.background },
            height === 'tall' ? { height: SCREEN_H * 0.88 } : { maxHeight: SCREEN_H * 0.9 },
            sheet,
          ]}
        >
          {showHandle ? <View style={styles.handle} /> : null}
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

export function SheetHeader({ title, onBack, left }: { title: string; onBack?: () => void; left?: React.ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.sheetHeader}>
      {left ?? (
        <CircleButton label="Close" onPress={onBack ?? (() => router.back())} tone="grey">
          <X size={18} color={theme.colors.text} />
        </CircleButton>
      )}
      <Text style={styles.sheetTitle} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: theme.fontSizes.sm,
    color: theme.colors.groupHeader,
    fontWeight: '500',
  },
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: {
    backgroundColor: theme.colors.pill,
    borderRadius: theme.radii.pill,
    paddingHorizontal: 18,
    paddingVertical: 10,
    maxWidth: '86%',
  },
  toastText: { color: theme.colors.pillText, fontSize: theme.fontSizes.sm, fontWeight: '500' },
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheetAvoid: { justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: theme.radii.sheet,
    borderTopRightRadius: theme.radii.sheet,
    paddingHorizontal: 16,
    paddingTop: 8,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
    marginBottom: 8,
  },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  sheetTitle: { flex: 1, fontSize: theme.fontSizes.lg, fontWeight: '600', color: theme.colors.text },
});
