import { AuthRevokedError, RateLimitError } from '@/api/client';

export type ErrorKind = 'offline' | 'unpaired' | 'rate-limited' | 'unknown';
export type BannerKind = Exclude<ErrorKind, 'unknown'>;

export interface BannerCopy {
  title: string;
  body: string;
}

const NETWORK_ERROR_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /network error/i,
  /internet connection/i,
  /connection (?:lost|refused|reset)/i,
  /timed? ?out/i,
  /no response/i,
];

export function isNetworkError(error: unknown): boolean {
  if (
    error instanceof AuthRevokedError ||
    error instanceof RateLimitError ||
    (error instanceof Error && (error.name === 'AuthRevokedError' || error.name === 'RateLimitError'))
  ) {
    return false;
  }
  if (error instanceof TypeError) return true;
  if (!(error instanceof Error) || error.name === 'AbortError') return false;
  return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(error.message));
}

export function classifyError(error: unknown): ErrorKind {
  if (
    error instanceof AuthRevokedError ||
    (error instanceof Error && error.name === 'AuthRevokedError')
  ) {
    return 'unpaired';
  }
  if (
    error instanceof RateLimitError ||
    (error instanceof Error && error.name === 'RateLimitError')
  ) {
    return 'rate-limited';
  }
  if (isNetworkError(error)) return 'offline';
  return 'unknown';
}

export function bannerFor(kind: ErrorKind): BannerCopy | null {
  switch (kind) {
    case 'offline':
      return {
        title: 'Cannot reach your computer',
        body: 'Check that the desktop app is running, then try again.',
      };
    case 'unpaired':
      return {
        title: 'Phone unpaired',
        body: 'This phone is no longer paired with the desktop. Pair it again to continue.',
      };
    case 'rate-limited':
      return {
        title: 'Slow down',
        body: 'The desktop is receiving too many requests. Wait a moment and try again.',
      };
    default:
      return null;
  }
}
