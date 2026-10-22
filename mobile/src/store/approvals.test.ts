import { ApprovalRequest } from '@/api/types';
import { HttpError, JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { respondToApproval } from '@/approvals/respond';
import { BIOMETRIC_SETUP_MESSAGE, useApprovals } from './approvals';

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, JasperClient: jest.fn() };
});
jest.mock('@/auth/useAuth', () => ({ useAuth: { getState: jest.fn() } }));
jest.mock('@/auth/secureStore', () => ({ loadCredentials: jest.fn() }));
jest.mock('@/approvals/respond', () => ({ respondToApproval: jest.fn() }));
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

const getApprovals = jest.fn();
const respondApproval = jest.fn();

function makeRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    request_id: 'req-1',
    tier: 2,
    action: 'Send the draft email',
    summary: 'Replying to the client',
    requester: 'jasper',
    created_at: '2026-01-02T10:30:00Z',
    ...overrides,
  };
}

describe('useApprovals', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth.getState as unknown as jest.Mock).mockReturnValue({
      credentials: { baseUrl: 'https://example.test', deviceId: 'device-1', deviceSecret: 'secret-1' },
      accessToken: 'token',
      deviceSecret: 'secret-1',
    });
    (JasperClient as unknown as jest.Mock).mockImplementation(() => ({ getApprovals, respondApproval }));
    useApprovals.setState({ requests: [], loading: false, error: null, responding: {} });
  });

  it('loads pending approvals', async () => {
    getApprovals.mockResolvedValue({ requests: [makeRequest()] });

    await useApprovals.getState().load();

    expect(useApprovals.getState().requests).toHaveLength(1);
    expect(useApprovals.getState().error).toBeNull();
  });

  it('reports a load failure', async () => {
    getApprovals.mockRejectedValue(new Error('Network down'));

    await useApprovals.getState().load();

    expect(useApprovals.getState().error).toBe('Network down');
  });

  it('removes a request after a successful response', async () => {
    useApprovals.setState({ requests: [makeRequest()] });
    (respondToApproval as unknown as jest.Mock).mockResolvedValue('approved');

    await useApprovals.getState().respond(makeRequest(), true);

    expect(useApprovals.getState().requests).toHaveLength(0);
    expect(useApprovals.getState().responding).toEqual({});
  });

  it('keeps the request and shows the biometric message when no biometrics are enrolled', async () => {
    useApprovals.setState({ requests: [makeRequest({ tier: 3 })] });
    (respondToApproval as unknown as jest.Mock).mockResolvedValue('no-biometrics');

    await useApprovals.getState().respond(makeRequest({ tier: 3 }), true);

    expect(useApprovals.getState().requests).toHaveLength(1);
    expect(useApprovals.getState().error).toBe(BIOMETRIC_SETUP_MESSAGE);
  });

  it('shows the biometric message on a 403', async () => {
    useApprovals.setState({ requests: [makeRequest({ tier: 3 })] });
    (respondToApproval as unknown as jest.Mock).mockRejectedValue(new HttpError(403, 'Forbidden'));

    await useApprovals.getState().respond(makeRequest({ tier: 3 }), true);

    expect(useApprovals.getState().requests).toHaveLength(1);
    expect(useApprovals.getState().error).toBe(BIOMETRIC_SETUP_MESSAGE);
    expect(useApprovals.getState().responding).toEqual({});
  });
});
