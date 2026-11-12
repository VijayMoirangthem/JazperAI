// react-native-reanimated 4 needs its native runtime, and its own jest mock does not load here. Screens only need the API surface,
// so this keeps animations inert: values are plain objects, animation helpers return their target, Animated.* are the plain RN views.
const RN = require('react-native');

const identity = (v) => v;
const easingFn = () => identity;
const Easing = new Proxy({ bezier: () => ({ factory: () => identity }) }, { get: (t, k) => (k in t ? t[k] : easingFn) });

module.exports = {
  __esModule: true,
  default: {
    View: RN.View,
    Text: RN.Text,
    ScrollView: RN.ScrollView,
    Image: RN.Image,
    FlatList: RN.FlatList,
    createAnimatedComponent: identity,
  },
  Easing,
  useSharedValue: (v) => ({ value: v }),
  useAnimatedStyle: (fn) => fn(),
  useDerivedValue: (fn) => ({ value: fn() }),
  useAnimatedProps: (fn) => fn(),
  interpolate: (v, input, output) => output[0],
  interpolateColor: (v, input, output) => output[0],
  withTiming: identity,
  withSpring: identity,
  withDelay: (_d, v) => v,
  withRepeat: identity,
  withSequence: (...v) => v[v.length - 1],
  cancelAnimation: () => {},
  runOnJS: identity,
  runOnUI: identity,
  Extrapolation: { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' },
  FadeIn: {},
  FadeOut: {},
};
