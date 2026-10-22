import { ApprovalRequest, RespondRequest, RespondResponse } from '@/api/types';
import { respondToApproval } from './respond';

function makeRequest(tier: number): ApprovalRequest {
  return {
    request_id: 'req-1',
    tier,
    action: 'Send the draft email',
    summary: 'Replying to the client',
    requester: 'jasper',
    created_at: '2026-01-02T10:30:00Z',
  };
}

function makeDeps(options: { biometrics?: boolean; authenticated?: boolean; secret?: string | null } = {}) {
  const order: string[] = [];
  const sent: RespondRequest[] = [];
  const deps = {
    hasBiometrics: async () => {
      order.push('biometrics');
      return options.biometrics ?? true;
    },
    authenticate: async () => {
      order.push('authenticate');
      return options.authenticated ?? true;
    },
    getDeviceSecret: async () => {
      order.push('secret');
      return options.secret === undefined ? 'device-secret' : options.secret;
    },
    send: async (body: RespondRequest): Promise<RespondResponse> => {
      order.push('send');
      sent.push(body);
      return { resolved: true };
    },
  };
  return { deps, order, sent };
}

describe('respondToApproval', () => {
  it('asks for biometrics before sending the tier-3 approval with the device secret', async () => {
    const { deps, order, sent } = makeDeps();

    const outcome = await respondToApproval(makeRequest(3), true, deps);

    expect(outcome).toBe('approved');
    expect(order).toEqual(['biometrics', 'authenticate', 'secret', 'send']);
    expect(sent).toEqual([{ approve: true, confirm: 'device-secret' }]);
  });

  it('denies without biometrics and never sends a confirm value', async () => {
    const { deps, order, sent } = makeDeps();

    const outcome = await respondToApproval(makeRequest(3), false, deps);

    expect(outcome).toBe('denied');
    expect(order).toEqual(['send']);
    expect(sent).toEqual([{ approve: false }]);
  });

  it('stops when the phone has no biometrics enrolled', async () => {
    const { deps, order, sent } = makeDeps({ biometrics: false });

    const outcome = await respondToApproval(makeRequest(3), true, deps);

    expect(outcome).toBe('no-biometrics');
    expect(order).toEqual(['biometrics']);
    expect(sent).toHaveLength(0);
  });

  it('stops when the biometric prompt is cancelled', async () => {
    const { deps, order, sent } = makeDeps({ authenticated: false });

    const outcome = await respondToApproval(makeRequest(3), true, deps);

    expect(outcome).toBe('cancelled');
    expect(order).toEqual(['biometrics', 'authenticate']);
    expect(sent).toHaveLength(0);
  });

  it('approves tier 2 without biometrics or a confirm value', async () => {
    const { deps, order, sent } = makeDeps();

    const outcome = await respondToApproval(makeRequest(2), true, deps);

    expect(outcome).toBe('approved');
    expect(order).toEqual(['send']);
    expect(sent).toEqual([{ approve: true }]);
  });

  it('refuses to approve tier 3 without a device secret', async () => {
    const { deps, sent } = makeDeps({ secret: null });

    await expect(respondToApproval(makeRequest(3), true, deps)).rejects.toThrow('device secret is missing');
    expect(sent).toHaveLength(0);
  });
});
