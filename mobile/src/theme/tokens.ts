import * as SecureStore from 'expo-secure-store';

export type ThemeMode = 'system' | 'light' | 'dark';

const LIGHT = {
  background: '#ffffff',
  surface: '#f7f7f8',
  raised: '#f0f0f1',
  border: 'rgba(0,0,0,0.09)',
  hairline: 'rgba(0,0,0,0.06)',
  text: '#111111',
  muted: 'rgba(0,0,0,0.52)',
  faint: 'rgba(0,0,0,0.32)',
  accent: '#1a82ff',
  success: '#1f9d55',
  successBg: '#e6f6ec',
  warning: '#d97706',
  warningBg: 'rgba(217,119,6,0.12)',
  danger: '#e5484d',
  dangerBg: 'rgba(229,72,77,0.10)',
  bubbleBot: '#f2f2f3',
  bubbleYou: '#111111',
  bubbleYouText: '#ffffff',
  composer: '#ffffff',
  groupHeader: 'rgba(0,0,0,0.50)',
  chipBg: '#ececee',
  chipText: 'rgba(0,0,0,0.55)',
  pill: '#111111',
  pillText: '#ffffff',
  pillSecondary: '#ececee',
  circle: '#ffffff',
  overlay: 'rgba(0,0,0,0.35)',
  shadow: '#000000',
} as const;

type Palette = { [K in keyof typeof LIGHT]: string };

const DARK: Palette = {
  background: '#0b0b0c',
  surface: '#151516',
  raised: '#1f1f21',
  border: 'rgba(255,255,255,0.10)',
  hairline: 'rgba(255,255,255,0.06)',
  text: '#f2f2f2',
  muted: 'rgba(255,255,255,0.58)',
  faint: 'rgba(255,255,255,0.34)',
  accent: '#3d94ff',
  success: '#34c26e',
  successBg: 'rgba(52,194,110,0.16)',
  warning: '#f59e0b',
  warningBg: 'rgba(245,158,11,0.16)',
  danger: '#f2555a',
  dangerBg: 'rgba(242,85,90,0.16)',
  bubbleBot: '#1f1f21',
  bubbleYou: '#f2f2f2',
  bubbleYouText: '#111111',
  composer: '#1b1b1d',
  groupHeader: 'rgba(255,255,255,0.55)',
  chipBg: '#2a2a2d',
  chipText: 'rgba(255,255,255,0.62)',
  pill: '#f2f2f2',
  pillText: '#111111',
  pillSecondary: '#2a2a2d',
  circle: '#1f1f21',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: '#000000',
};

const MODE_KEY = 'jasper-theme-mode';

export function readThemeMode(): ThemeMode {
  try {
    const value = SecureStore.getItem(MODE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // Secure store may be unavailable (tests, first launch).
  }
  return 'system';
}

export function writeThemeMode(mode: ThemeMode): void {
  try {
    SecureStore.setItem(MODE_KEY, mode);
  } catch {
    // Best effort.
  }
}

function resolveDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  // System follows the phone, but the product default is the light look.
  return false;
}

export const THEME_MODE = readThemeMode();
export const IS_DARK = resolveDark(THEME_MODE);

export const COLORS: Palette = IS_DARK ? DARK : LIGHT;

export const RADII = {
  bubble: 20,
  card: 16,
  pill: 999,
  button: 12,
  sheet: 28,
  circle: 22,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const FONT_SIZES = {
  xs: 11,
  sm: 13,
  base: 15,
  body: 16,
  lg: 17,
  xl: 20,
  title: 24,
  hero: 34,
} as const;

/** The 12 mascot colours of the colour picker, in display order. */
export const MASCOT_PALETTE = {
  white: '#FFFFFF',
  brown: '#8B5A3C',
  red: '#F0384F',
  orange: '#FF6B00',
  amber: '#FFA81A',
  green: '#10C46B',
  teal: '#19B8A2',
  blue: '#1A82FF',
  purple: '#8B5CF6',
  pink: '#FF2E93',
  grey: '#8E8E93',
  black: '#0F0F10',
} as const;

/** Older names kept so looks saved by V1 keep their colour. */
export const MASCOT_COLORS = {
  ...MASCOT_PALETTE,
  cyan: '#0EA5C6',
  yellow: '#D8A729',
  coral: '#E5634E',
} as const;

export const SHADOWS = {
  circle: {
    shadowColor: COLORS.shadow,
    shadowOpacity: IS_DARK ? 0.5 : 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  composer: {
    shadowColor: COLORS.shadow,
    shadowOpacity: IS_DARK ? 0.5 : 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sheet: {
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16,
  },
} as const;

export type ColorKey = keyof typeof LIGHT;
export type RadiusKey = keyof typeof RADII;
export type SpacingKey = keyof typeof SPACING;
export type FontSizeKey = keyof typeof FONT_SIZES;
export type MascotColorKey = keyof typeof MASCOT_COLORS;
export type MascotPaletteKey = keyof typeof MASCOT_PALETTE;

export const theme = {
  colors: COLORS,
  radii: RADII,
  spacing: SPACING,
  fontSizes: FONT_SIZES,
  mascotColors: MASCOT_COLORS,
  shadows: SHADOWS,
  isDark: IS_DARK,
} as const;

export type Theme = typeof theme;
