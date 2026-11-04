import React, { useEffect, useId, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
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
import { colorHex, isLightColor, mascotGradient } from '@/utils/mascot';
import { lookFor, useMascotLooks } from '@/store/mascot';

export type MascotState = 'idle' | 'thinking' | 'working' | 'alerting' | 'sad' | 'happy';

export interface MascotProps {
  slug: string;
  size?: number;
  state?: MascotState;
  animated?: boolean;
  color?: string;
  body?: MascotBodyId;
}

/** The artwork canvas. Bodies are fitted into 0..CANVAS and the face anchors use the same space. */
const CANVAS = 228.54;
const EYE_SPREAD = 25;
const EYE_RISE = 3;
const EYE_WIDTH = 22;
const EYE_HEIGHT = 26;
/** Both eyes lean the same way, like the two slanted pills of the Jasper face. */
const EYE_TILT = 14;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotion = value;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reduceMotion = value;
});

function eyePose(state: MascotState): { x: number; y: number; scaleX: number; scaleY: number; rotate: number } {
  switch (state) {
    case 'thinking':
      return { x: -3, y: -4, scaleX: 1, scaleY: 1, rotate: 0 };
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
  const saved = useMascotLooks((store) => store.looks[slug]);
  const look = useMemo(() => lookFor(saved ? { [slug]: saved } : {}, slug), [saved, slug]);
  const shape = MASCOT_BODIES[body ?? look.body] ?? MASCOT_BODIES.cursor;
  const fill = colorHex(color ?? look.color);
  const light = isLightColor(fill);
  const gradient = useMemo(() => mascotGradient(fill), [fill]);
  const rawId = useId();
  const gradientId = useMemo(() => `mascot-${rawId.replace(/[^a-zA-Z0-9]/g, '')}`, [rawId]);
  const [still] = useState(() => reduceMotion);

  const blink = useSharedValue(1);
  const motion = useSharedValue(0);
  const look2 = useSharedValue(0);

  const live = animated && !still;

  useEffect(() => {
    blink.value = 1;
    motion.value = 0;
    look2.value = 0;
    if (!live) return;

    // A random start delay keeps a screenful of mascots from blinking in unison.
    const wait = 2600 + Math.round(Math.random() * 3600);
    blink.value = withRepeat(
      withSequence(withDelay(wait, withTiming(0.12, { duration: 110 })), withTiming(1, { duration: 130 })),
      -1
    );

    if (state === 'idle') {
      motion.value = withRepeat(
        withSequence(
          withTiming(-0.8, { duration: 1700, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 1700, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      );
      look2.value = withRepeat(
        withSequence(
          withDelay(2200 + Math.round(Math.random() * 2500), withTiming(-3, { duration: 260 })),
          withDelay(700, withTiming(3, { duration: 320 })),
          withDelay(600, withTiming(0, { duration: 260 }))
        ),
        -1
      );
    } else if (state === 'thinking') {
      motion.value = withRepeat(
        withSequence(withTiming(-1.5, { duration: 520 }), withTiming(1.5, { duration: 520 })),
        -1,
        true
      );
    } else if (state === 'working') {
      motion.value = withRepeat(
        withSequence(
          withTiming(-3, { duration: 450, easing: Easing.inOut(Easing.quad) }),
          withTiming(0, { duration: 450, easing: Easing.inOut(Easing.quad) })
        ),
        -1
      );
    } else if (state === 'alerting') {
      motion.value = withRepeat(
        withSequence(withTiming(2.5, { duration: 70 }), withTiming(-2.5, { duration: 70 }), withTiming(0, { duration: 70 })),
        -1
      );
    } else if (state === 'happy') {
      motion.value = withRepeat(withSequence(withTiming(-4, { duration: 410 }), withTiming(0, { duration: 410 })), -1);
    }

    return () => {
      cancelAnimation(blink);
      cancelAnimation(motion);
      cancelAnimation(look2);
    };
  }, [live, blink, motion, look2, state]);

  const pose = eyePose(state);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: motion.value }, { rotate: `${state === 'sad' ? 3 : state === 'thinking' ? motion.value : 0}deg` }],
  }));

  const eyeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: pose.x + look2.value },
      { translateY: pose.y },
      { scaleX: pose.scaleX },
      { scaleY: blink.value * pose.scaleY },
      { rotate: `${EYE_TILT + pose.rotate}deg` },
    ],
  }));

  const unit = size / CANVAS;
  const eyeWidth = EYE_WIDTH * shape.anchor.scale * unit;
  const eyeHeight = EYE_HEIGHT * shape.anchor.scale * unit;
  const eyeTop = (shape.anchor.y - EYE_RISE * shape.anchor.scale) * unit - eyeHeight / 2;
  const eyeLeft = (shape.anchor.x - EYE_SPREAD * shape.anchor.scale) * unit - eyeWidth / 2;
  const eyeRight = (shape.anchor.x + EYE_SPREAD * shape.anchor.scale) * unit - eyeWidth / 2;
  const eyeColor = light ? '#1a1a1a' : '#ffffff';

  const dotSize = Math.max(2, size * 0.045);
  const dotGap = Math.max(1, size * 0.03);
  const dotsWidth = dotSize * 3 + dotGap * 2;
  const dotsTop = (shape.anchor.y + 32 * shape.anchor.scale) * unit;
  const dotsLeft = shape.anchor.x * unit - dotsWidth / 2;

  return (
    <View style={[styles.container, { width: size, height: size }]} testID={`mascot-${slug}`} accessible={false}>
      <Animated.View style={[styles.body, containerStyle]}>
        <Svg width={size} height={size} viewBox={`0 0 ${CANVAS} ${CANVAS}`}>
          <Defs>
            <LinearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor={gradient[0]} />
              <Stop offset="55%" stopColor={gradient[1]} />
              <Stop offset="100%" stopColor={gradient[2]} />
            </LinearGradient>
          </Defs>
          <G transform={shape.fit}>
            <Path
              d={shape.d}
              fill={`url(#${gradientId})`}
              stroke={light ? 'rgba(0,0,0,0.14)' : undefined}
              strokeWidth={light ? 1.6 : 0}
            />
          </G>
        </Svg>

        <Animated.View style={[styles.eye, { backgroundColor: eyeColor, left: eyeLeft, top: eyeTop, width: eyeWidth, height: eyeHeight }, eyeStyle]} />
        <Animated.View style={[styles.eye, { backgroundColor: eyeColor, left: eyeRight, top: eyeTop, width: eyeWidth, height: eyeHeight }, eyeStyle]} />

        {state === 'thinking' ? (
          <View
            style={[styles.dots, { top: dotsTop, left: dotsLeft, gap: dotGap }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {[0, 1, 2].map((i) => (
              <View key={i} style={{ width: dotSize, height: dotSize, borderRadius: 999, backgroundColor: eyeColor, opacity: 0.7 }} />
            ))}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  body: { width: '100%', height: '100%' },
  eye: { position: 'absolute', borderRadius: 999 },
  dots: { position: 'absolute', flexDirection: 'row', alignItems: 'center' },
});

export default Mascot;
