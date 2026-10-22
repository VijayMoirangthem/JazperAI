import { MASCOT_BODY_IDS, MascotBodyId } from '@/mascot/bodies';
import { theme } from '@/theme/tokens';

export const FALLBACK_COLOR_KEYS = [
  'green',
  'orange',
  'purple',
  'cyan',
  'pink',
  'teal',
  'coral',
  'yellow',
  'red',
] as const;

export const MASCOT_COLOR_KEYS = [
  'green',
  'blue',
  'red',
  'orange',
  'purple',
  'cyan',
  'pink',
  'yellow',
  'teal',
  'coral',
] as const;

export type MascotColorKey = (typeof MASCOT_COLOR_KEYS)[number];

export function mascotHash(slug: string): number {
  return [...slug].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 7);
}

export function defaultMascotColor(slug: string): string {
  if (slug === 'jasper') return theme.mascotColors.blue;
  const key = FALLBACK_COLOR_KEYS[mascotHash(slug) % FALLBACK_COLOR_KEYS.length];
  return theme.mascotColors[key];
}

export function defaultMascotBody(slug: string): MascotBodyId {
  if (slug === 'jasper') return 'cursor';
  return MASCOT_BODY_IDS[mascotHash(slug) % MASCOT_BODY_IDS.length];
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

export function mascotGradient(color: string): [string, string, string] {
  return [mixHex(color, '#ffffff', 0.55), color, mixHex(color, '#000000', 0.42)];
}
