import React, { useEffect, useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';
import { MASCOT_BODIES, MascotBodyId } from '@/mascot/bodies';
import { mascotGradient } from '@/utils/mascot';
import { lookFor, useMascotLooks } from '@/store/mascot';
import { theme } from '@/theme/tokens';

export type MascotState = 'idle' | 'thinking' | 'working' | 'alerting' | 'sad' | 'happy';

export interface MascotProps {
  slug: string;
  size?: number;
  state?: MascotState;
  animated?: boolean;
  color?: string;
  body?: MascotBodyId;
}

const VIEW = 200;
const EYE_SPREAD = 25;
const EYE_RISE = 3;
const EYE_WIDTH = 22;
const EYE_HEIGHT = 26;

function eyePose(state: MascotState): {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
} {
  switch (state) {
    case 'thinking':
      return { x: -2, y: -3, scaleX: 1, scaleY: 1, rotate: 0 };
    case 'working':
      return { x: 0, y: 1, scaleX: 1, scaleY: 0.55, rotate: 0 };
    case 'alerting':
      return { x: 0, y: 0, scaleX: 1.15, scaleY: 1.2, rotate: 0 };
    case 'sad':
      return { x: 0, y: 2, scaleX: 1, scaleY: 0.8, rotate: 10 };
    case 'happy':
      return { x: 0, y: 2, scaleX: 1, scaleY: 0.35, rotate: 0 };
    default:
      return { x: 0, y: 0, scaleX: 1, scaleY: 1, rotate: 0 };
  }
}

export const Mascot = React.memo(function Mascot({
  slug,
  size = 40,
  state = 'idle',
  animated = true,
  color,
  body,
}: MascotProps) {
  const looks = useMascotLooks((store) => store.looks);
  const look = lookFor(looks, slug);
  const shape = MASCOT_BODIES[body ?? look.body] ?? MASCOT_BODIES.cursor;
  const gradient = useMemo(() => mascotGradient(color ?? look.color), [color, look.color]);
  const rawId = useId();
  const gradientId = useMemo(() => `mascot-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);

  const blink = useSharedValue(1);
  const motion = useSharedValue(0);

  useEffect(() => {
    blink.value = 1;
    motion.value = 0;
    if (!animated) return;

    blink.value = withRepeat(
      withSequence(
        withDelay(3400, withTiming(0.12, { duration: 110 })),
        withTiming(1, { duration: 130 })
      ),
      -1
    );

    if (state === 'working') {
      motion.value = withRepeat(
        withSequence(
          withTiming(-3, { duration: 450, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 450, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      );
    } else if (state === 'alerting') {
      motion.value = withRepeat(
        withSequence(
          withTiming(2.5, { duration: 70 }),
          withTiming(-2.5, { duration: 70 }),
          withTiming(0, { duration: 70 })
        ),
        -1
      );
    } else if (state === 'happy') {
      motion.value = withRepeat(
        withSequence(withTiming(-4, { duration: 410 }), withTiming(0, { duration: 410 })),
        -1
      );
    }

    return () => {
      cancelAnimation(blink);
      cancelAnimation(motion);
    };
  }, [animated, blink, motion, state]);

  const pose = eyePose(state);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: motion.value },
      { rotate: `${state === 'sad' ? 3 : 0}deg` },
    ],
  }));

  const leftEyeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pose.x },
      { translateY: pose.y },
      { scaleX: pose.scaleX },
      { scaleY: blink.value * pose.scaleY },
      { rotate: `${pose.rotate}deg` },
    ],
  }));

  const rightEyeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pose.x },
      { translateY: pose.y },
      { scaleX: pose.scaleX },
      { scaleY: blink.value * pose.scaleY },
      { rotate: `${-pose.rotate}deg` },
    ],
  }));

  const unit = size / VIEW;
  const eyeWidth = EYE_WIDTH * shape.anchor.scale * unit;
  const eyeHeight = EYE_HEIGHT * shape.anchor.scale * unit;
  const eyeTop = (shape.anchor.y - EYE_RISE * shape.anchor.scale) * unit - eyeHeight / 2;
  const eyeLeft = (shape.anchor.x - EYE_SPREAD * shape.anchor.scale) * unit - eyeWidth / 2;
  const eyeRight = (shape.anchor.x + EYE_SPREAD * shape.anchor.scale) * unit - eyeWidth / 2;

  const dotSize = Math.max(2, size * 0.045);
  const dotGap = Math.max(1, size * 0.03);
  const dotsWidth = dotSize * 3 + dotGap * 2;
  const dotsTop = (shape.anchor.y + 32 * shape.anchor.scale) * unit;
  const dotsLeft = shape.anchor.x * unit - dotsWidth / 2;

  return (
    <View
      style={[styles.container, { width: size, height: size }]}
      testID={`mascot-${slug}`}
      accessible={false}
    >
      <Animated.View style={[styles.body, containerStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={gradient[0]} />
              <stop offset="55%" stopColor={gradient[1]} />
              <stop offset="100%" stopColor={gradient[2]} />
            </LinearGradient>
          </Defs>
          <G transform={shape.fit}>
            <Path d={shape.d} fill={`url(#${gradientId})`} />
          </G>
        </Svg>

        <Animated.View
          style={[
            styles.eye,
            styleAt(eyeLeft, eyeTop, eyeWidth, eyeHeight),
            leftEyeStyle,
          ]}
        />
        <Animated.View
          style={[
            styles.eye,
            styleAt(eyeRight, eyeTop, eyeWidth, eyeHeight),
            rightEyeStyle,
          ]}
        />

        {state === 'thinking' ? (
          <View
            style={[styles.dots, { top: dotsTop, left: dotsLeft, gap: dotGap }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <View style={[styles.dot, { width: dotSize, height: dotSize }]} />
            <View style={[styles.dot, { width: dotSize, height: dotSize }]} />
            <View style={[styles.dot, { width: dotSize, height: dotSize }]} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
});

function styleAt(left: number, top: number, width: number, height: number) {
  return { left, top, width, height };
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    width: '100%',
    height: '100%',
  },
  eye: {
    position: 'absolute',
    backgroundColor: '#ffffff',
    borderRadius: 999,
  },
  dots: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    borderRadius: 999,
    backgroundColor: theme.colors.text,
    opacity: 0.7,
  },
});

export default Mascot;
