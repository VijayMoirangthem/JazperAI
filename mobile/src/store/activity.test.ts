import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';
import { useActivity } from './activity';

jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, JasperClient: jest.fn() };
});
jest.mock('@/auth/useAuth', () => ({ useAuth: { getState: jest.fn() } }));

const getStatus = jest.fn();
const getCommsThreads = jest.fn();

const credentials = {
  baseUrl: 'https://example.test',
  deviceId: 'device-1',
  deviceSecret: 'secret-1',
};

describe('useActivity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth.getState as unknown as jest.Mock).mockReturnValue({
      credentials,
      accessToken: 'token',
    });
    (JasperClient as unknown as jest.Mock).mockImplementation(() => ({
      getStatus,
      getCommsThreads,
    }));
    useActivity.setState({ status: null, threads: [], loading: false, error: null });
  });

  it('loads status and conversations together', async () => {
    getStatus.mockResolvedValue({
      slos: [
        {
          slo: 'api',
          target: 0.995,
          sli: 0.999,
          events: 100,
          bad: 1,
          budget_remaining: 0.8,
          status: 'ok',
        },
      ],
      pending_approvals: 2,
    });
    getCommsThreads.mockResolvedValue({
      threads: [
        {
          thread: 'jasper:messenger',
          from_slug: 'jasper',
          to_slug: 'messenger',
          kind: 'ask',
          preview: 'Any mail for me?',
          ts: '2026-10-23T09:00:00Z',
          n: 3,
        },
      ],
    });

    await useActivity.getState().load();

    expect(getStatus).toHaveBeenCalledWith({
      deviceId: 'device-1',
      deviceSecret: 'secret-1',
    });
    expect(getCommsThreads).toHaveBeenCalledWith({
      deviceId: 'device-1',
      deviceSecret: 'secret-1',
    });
    expect(useActivity.getState().status?.pending_approvals).toBe(2);
    expect(useActivity.getState().threads).toHaveLength(1);
    expect(useActivity.getState().error).toBeNull();
    expect(useActivity.getState().loading).toBe(false);
  });

  it('reports a load failure and keeps the previous data', async () => {
    useActivity.setState({ threads: [] });
    getStatus.mockRejectedValue(new Error('Network down'));
    getCommsThreads.mockResolvedValue({ threads: [] });

    await useActivity.getState().load();

    expect(useActivity.getState().error).toBe('Network down');
    expect(useActivity.getState().loading).toBe(false);
  });

  it('clears an error', () => {
    useActivity.setState({ error: 'Network down' });

    useActivity.getState().clearError();

    expect(useActivity.getState().error).toBeNull();
  });
});
