import { ApprovalRequest, RespondRequest, RespondResponse } from '@/api/types';
import { needsBiometricConfirmation } from '@/utils/approvals';

export type RespondOutcome = 'approved' | 'denied' | 'cancelled' | 'no-biometrics';

export interface RespondDeps {
  hasBiometrics: () => Promise<boolean>;
  authenticate: () => Promise<boolean>;
  getDeviceSecret: () => Promise<string | null>;
  send: (body: RespondRequest) => Promise<RespondResponse>;
}

export async function respondToApproval(
  request: ApprovalRequest,
  approve: boolean,
  deps: RespondDeps
): Promise<RespondOutcome> {
  if (!approve) {
    await deps.send({ approve: false });
    return 'denied';
  }

  if (needsBiometricConfirmation(request.tier, approve)) {
    if (!(await deps.hasBiometrics())) {
      return 'no-biometrics';
    }
    const authenticated = await deps.authenticate();
    if (!authenticated) {
      return 'cancelled';
    }
    const confirm = await deps.getDeviceSecret();
    if (!confirm) {
      throw new Error('The device secret is missing. Pair this phone again.');
    }
    await deps.send({ approve: true, confirm });
    return 'approved';
  }

  await deps.send({ approve: true });
  return 'approved';
}
