export const COLORS = {
  background: '#0b0b0b',
  surface: '#161616',
  raised: '#1f1f1f',
  border: 'rgba(255,255,255,0.10)',
  text: '#f2f2f2',
  muted: 'rgba(255,255,255,0.55)',
  accent: '#2563eb',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  bubbleBot: 'rgba(255,255,255,0.08)',
  bubbleYou: '#5c5c5c',
  composer: 'rgba(255,255,255,0.10)',
  groupHeader: 'rgba(255,255,255,0.60)',
} as const;

export const RADII = {
  bubble: 20,
  card: 16,
  pill: 999,
  button: 12,
} as const;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const FONT_SIZES = {
  xs: 11,
  sm: 13,
  base: 15,
  lg: 17,
  xl: 20,
  title: 24,
} as const;

export const MASCOT_COLORS = {
  green: '#009957',
  blue: '#377FE6',
  red: '#D94B52',
  orange: '#E78531',
  purple: '#8057C8',
  cyan: '#0EA5C6',
  pink: '#D84F8B',
  yellow: '#D8A729',
  teal: '#01A492',
  coral: '#E5634E',
} as const;

export type ColorKey = keyof typeof COLORS;
export type RadiusKey = keyof typeof RADII;
export type SpacingKey = keyof typeof SPACING;
export type FontSizeKey = keyof typeof FONT_SIZES;
export type MascotColorKey = keyof typeof MASCOT_COLORS;

export const theme = {
  colors: COLORS,
  radii: RADII,
  spacing: SPACING,
  fontSizes: FONT_SIZES,
  mascotColors: MASCOT_COLORS,
} as const;

export type Theme = typeof theme;