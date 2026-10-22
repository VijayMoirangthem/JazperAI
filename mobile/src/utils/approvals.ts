export const UNTRUSTED_MARKER = 'UNTRUSTED CONTENT';

export function hasUntrustedMarker(summary: string): boolean {
  return summary.includes(UNTRUSTED_MARKER);
}

export function needsBiometricConfirmation(tier: number, approve: boolean): boolean {
  return approve && tier >= 3;
}
