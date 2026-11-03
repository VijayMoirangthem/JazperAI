import { MascotBodyId } from '@/mascot/bodies';
import { MASCOT_COLORS, MASCOT_PALETTE } from '@/theme/tokens';

/** The 12 colours of the picker, in display order. */
export const MASCOT_PALETTE_KEYS = [
  'white',
  'brown',
  'red',
  'orange',
  'amber',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
  'grey',
  'black',
] as const;

export type MascotPaletteName = (typeof MASCOT_PALETTE_KEYS)[number];

/** The 8 shapes of the picker (two rows of four). */
export const PICKER_BODIES: MascotBodyId[] = ['circle', 'blob', 'squircle', 'capsule', 'triangle', 'hexagon', 'cloud', 'drop'];

/** Colours used when a bot has no saved look: lively ones, never white/black/grey. */
export const FALLBACK_COLOR_KEYS = ['green', 'orange', 'purple', 'teal', 'pink', 'blue', 'red', 'amber', 'brown'] as const;

export const MASCOT_COLOR_KEYS = MASCOT_PALETTE_KEYS;

export type MascotColorKey = MascotPaletteName;

export function mascotHash(slug: string): number {
  return [...slug].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
}

export function defaultMascotColor(slug: string): string {
  if (slug === 'jasper') return MASCOT_PALETTE.blue;
  const key = FALLBACK_COLOR_KEYS[mascotHash(slug) % FALLBACK_COLOR_KEYS.length];
  return MASCOT_PALETTE[key];
}

export function defaultMascotBody(slug: string): MascotBodyId {
  if (slug === 'jasper') return 'cursor';
  return PICKER_BODIES[(mascotHash(slug) >>> 3) % PICKER_BODIES.length];
}

/** Hex for a palette name or an old/unknown value (hex strings pass through). */
export function colorHex(nameOrHex: string): string {
  if (nameOrHex.startsWith('#')) return nameOrHex;
  return (MASCOT_COLORS as Record<string, string>)[nameOrHex] ?? MASCOT_PALETTE.blue;
}

/** The palette name for a hex colour (used when syncing the look to the server). */
export function colorName(hex: string): MascotPaletteName {
  const lower = hex.toLowerCase();
  const found = MASCOT_PALETTE_KEYS.find((key) => MASCOT_PALETTE[key].toLowerCase() === lower);
  return found ?? 'blue';
}

export function isLightColor(hex: string): boolean {
  const value = Number.parseInt(colorHex(hex).slice(1, 7), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 200;
}

export function mixHex(hex: string, toward: string, amount: number): string {
  const from = Number.parseInt(hex.slice(1), 16);
  const to = Number.parseInt(toward.slice(1), 16);
  const channel = (shift: number) => {
    const value = Math.round(
      ((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * amount
    );
    return value.toString(16).padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

/** Flat, slightly glossy: a faint highlight at the top and a faint shade at the bottom. */
export function mascotGradient(color: string): [string, string, string] {
  const hex = colorHex(color);
  return [mixHex(hex, '#ffffff', 0.16), hex, mixHex(hex, '#000000', 0.12)];
}
