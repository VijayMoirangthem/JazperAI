import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Star } from 'lucide-react-native';
import { Mascot, MascotState } from '@/components/Mascot';
import { MascotBodyId } from '@/mascot/bodies';
import { theme } from '@/theme/tokens';

interface DecoratedProps {
  slug: string;
  size: number;
  state?: MascotState;
  animated?: boolean;
  star?: boolean;
  attention?: boolean;
  color?: string;
  body?: MascotBodyId;
}

/** A mascot with the optional star badge (favourite) and the orange "needs you" dot. */
export function MascotWithBadges({ slug, size, state, animated = false, star, attention, color, body }: DecoratedProps) {
  const badge = Math.max(14, Math.round(size * 0.3));
  return (
    <View style={{ width: size, height: size }}>
      <Mascot slug={slug} size={size} state={state} animated={animated} color={color} body={body} />
      {star ? (
        <View
          style={[styles.badge, { width: badge, height: badge, borderRadius: badge / 2, right: -badge * 0.1, bottom: -badge * 0.05 }]}
          accessibilityLabel="Favourite"
        >
          <Star size={badge * 0.56} color="#ffffff" fill="#ffffff" />
        </View>
      ) : null}
      {attention ? (
        <View
          accessibilityLabel="Needs your attention"
          style={[styles.dot, { width: Math.max(10, size * 0.2), height: Math.max(10, size * 0.2), borderRadius: size, right: size * 0.02, bottom: size * 0.02 }]}
        />
      ) : null}
    </View>
  );
}

export interface ClusterItem {
  key: string;
  body: MascotBodyId;
  color: string;
  size: number;
  /** Position of the mascot centre, as a fraction of the container (0..1). */
  x: number;
  y: number;
  rotate: number;
  drift: number;
  delay: number;
}

function Floating({ item, still }: { item: ClusterItem; still: boolean }) {
  const pop = useSharedValue(0);
  const drift = useSharedValue(0);
  useEffect(() => {
    pop.value = withDelay(item.delay, withSpring(1, { damping: 11, stiffness: 120 }));
    if (!still) {
      drift.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 6000 + item.drift * 700, easing: Easing.inOut(Easing.sin) }),
          withTiming(-1, { duration: 6000 + item.drift * 700, easing: Easing.inOut(Easing.sin) })
        ),
        -1,
        true
      );
    }
  }, [pop, drift, item.delay, item.drift, still]);
  const style = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [
      { translateY: drift.value * (4 + item.drift) },
      { translateX: drift.value * 3 },
      { rotate: `${item.rotate + drift.value * 2}deg` },
      { scale: pop.value },
    ],
  }));
  return (
    <Animated.View
      style={[{ position: 'absolute', left: `${item.x * 100}%`, top: `${item.y * 100}%`, marginLeft: -item.size / 2, marginTop: -item.size / 2 }, style]}
      pointerEvents="none"
    >
      <Mascot slug={item.key} size={item.size} body={item.body} color={item.color} animated={false} />
    </Animated.View>
  );
}

/** Decorative mascots drifting around the screen (Welcome screen). Some sit on the edge and are cut off. */
export function MascotCluster({ items, still = false }: { items: ClusterItem[]; still?: boolean }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((item) => (
        <Floating key={item.key} item={item} still={still} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    backgroundColor: theme.colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.background,
  },
  dot: {
    position: 'absolute',
    backgroundColor: '#ff8a00',
    borderWidth: 2,
    borderColor: theme.colors.background,
  },
});
