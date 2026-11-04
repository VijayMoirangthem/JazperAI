/**
 * Where the phone finds Jasper. In development the founder runs `adb reverse tcp:8000 tcp:8000`
 * so the phone's localhost reaches the PC. Set EXPO_PUBLIC_JASPER_URL to override at build time.
 */
export const SERVER_URL: string = process.env.EXPO_PUBLIC_JASPER_URL ?? 'http://localhost:8000';

export const BRAND = {
  name: 'Jasper',
  tagline: 'Your team of always-on agents that finish the work.',
} as const;
