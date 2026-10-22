import { hasUntrustedMarker, needsBiometricConfirmation } from './approvals';

describe('approval helpers', () => {
  it('detects the untrusted marker', () => {
    expect(hasUntrustedMarker('Summarised <UNTRUSTED CONTENT> from a page')).toBe(true);
  });

  it('ignores ordinary summaries', () => {
    expect(hasUntrustedMarker('Send the weekly report to the team')).toBe(false);
  });

  it('requires biometrics only for approvals of tier 3 or above', () => {
    expect(needsBiometricConfirmation(3, true)).toBe(true);
    expect(needsBiometricConfirmation(4, true)).toBe(true);
    expect(needsBiometricConfirmation(3, false)).toBe(false);
    expect(needsBiometricConfirmation(2, true)).toBe(false);
  });
});
