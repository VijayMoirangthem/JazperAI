import { AuthRevokedError } from '@/api/client';
import { useAuth } from '@/auth/useAuth';

const creds = { baseUrl: 'https://pc.example.ts.net', deviceId: 'dev-1', deviceSecret: 'secret' };

const mockRefresh = jest.fn();
const mockMe = jest.fn();
jest.mock('@/api/client', () => {
  class AuthRevokedError extends Error {}
  return {
    AuthRevokedError,
    JasperClient: jest.fn().mockImplementation(() => ({ refresh: mockRefresh, me: mockMe })),
  };
});
jest.mock('@/api/session', () => ({ resetSession: jest.fn() }));
jest.mock('@/notifications/setup', () => ({ registerForPushNotifications: jest.fn() }));
jest.mock('@/config', () => ({ SERVER_URL: 'https://pc.example.ts.net' }));

const mockLoad = jest.fn();
const mockClear = jest.fn();
jest.mock('@/auth/secureStore', () => ({
  loadCredentials: () => mockLoad(),
  clearCredentials: () => mockClear(),
  saveCredentials: jest.fn(),
}));

// eslint-disable-next-line import/first
import { getAuthProvider, REFRESH_RETRY_DELAYS_MS } from '@/auth/AuthProvider';

describe('restore keeps the pairing when the PC is unreachable', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    useAuth.getState().clear();
    mockLoad.mockResolvedValue(creds);
  });
  afterEach(async () => {
    await getAuthProvider().signOut(); // also cancels any retry timer
    jest.useRealTimers();
  });

  it('stays paired (offline) after a network error and does not throw', async () => {
    mockRefresh.mockRejectedValue(new TypeError('Network request failed'));
    await expect(getAuthProvider().restore()).resolves.toBeNull();
    expect(useAuth.getState().credentials).toEqual(creds);
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('throws only when the PC says the device was removed', async () => {
    mockRefresh.mockRejectedValue(new AuthRevokedError());
    await expect(getAuthProvider().restore()).rejects.toBeInstanceOf(AuthRevokedError);
  });

  it('gets a token by itself once the PC is back', async () => {
    mockRefresh.mockRejectedValueOnce(new TypeError('Network request failed'));
    await getAuthProvider().restore();
    expect(useAuth.getState().accessToken).toBeNull();

    mockRefresh.mockResolvedValue({ access_token: 'tok' });
    mockMe.mockResolvedValue({ name: 'Jasper Phone (android)' });
    await jest.advanceTimersByTimeAsync(REFRESH_RETRY_DELAYS_MS[0] + 10);
    expect(useAuth.getState().accessToken).toBe('tok');
  });

  it('signs out if the retry learns the device was removed', async () => {
    mockRefresh.mockRejectedValueOnce(new TypeError('Network request failed'));
    await getAuthProvider().restore();
    mockRefresh.mockRejectedValue(new AuthRevokedError());
    await jest.advanceTimersByTimeAsync(REFRESH_RETRY_DELAYS_MS[0] + 10);
    expect(useAuth.getState().credentials).toBeNull();
    expect(mockClear).toHaveBeenCalled();
  });

  it('does nothing when nothing is stored', async () => {
    mockLoad.mockResolvedValue(null);
    await expect(getAuthProvider().restore()).resolves.toBeNull();
    expect(useAuth.getState().credentials).toBeNull();
  });
});
