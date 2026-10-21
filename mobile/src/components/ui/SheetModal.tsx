import { Modal, View, StyleSheet, ViewStyle, Animated, KeyboardAvoidingView, Platform } from 'react-native';
import React, { useEffect, useRef, useState } from 'react';
import { theme } from '@/theme/tokens';
import { Text } from './Text';

interface SheetModalProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title?: string;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
  accessibilityLabel?: string;
}

export function SheetModal({
  visible,
  onClose,
  children,
  title,
  style,
  contentStyle,
  accessibilityLabel,
}: SheetModalProps) {
  const animation = useRef(new Animated.Value(0));
  const [isMounted, setIsMounted] = useState(visible);

  useEffect(() => {
    let mounted = true;
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsMounted(true);
    }
    Animated.timing(animation.current, {
      toValue: visible ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (mounted && !visible && finished) {
        setIsMounted(false);
      }
    });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!isMounted) {
    return null;
  }

  // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/refs
  const translateY = animation.current.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  // eslint-disable-next-line react-hooks/rules-of-hooks, react-hooks/refs
  const opacity = animation.current.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  return (
    <Modal
      visible={isMounted}
      transparent
      onRequestClose={onClose}
      animationType="none"
      presentationStyle="overFullScreen"
    >
      <Animated.View
        style={StyleSheet.flatten([styles.overlay, { opacity }]) ?? undefined}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetContainer}
        >
          <Animated.View
            style={StyleSheet.flatten([styles.sheet, { transform: [{ translateY }] }, style]) ?? undefined}
            accessibilityLabel={accessibilityLabel}
            accessibilityRole="dialog"
          >
            {title && (
              <View style={styles.header}>
                <Text variant="title" style={styles.headerTitle}>
                  {title}
                </Text>
              </View>
            )}
            <View style={StyleSheet.flatten([{ flex: 1, padding: theme.spacing.lg }, contentStyle]) ?? undefined}>
              {children}
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radii.card,
    borderTopRightRadius: theme.radii.card,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: {
    fontWeight: '600',
  },
});

export default SheetModal;