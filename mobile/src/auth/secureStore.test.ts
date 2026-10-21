import * as SecureStore from 'expo-secure-store';
import { saveCredentials, loadCredentials, clearCredentials } from './secureStore';

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('secureStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('saveCredentials', () => {
    it('stores credentials as JSON', async () => {
      (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);

      await saveCredentials({
        baseUrl: 'https://api.example.com',
        deviceId: 'device-1',
        deviceSecret: 'secret-1',
      });

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'jasper_credentials',
        JSON.stringify({
          baseUrl: 'https://api.example.com',
          deviceId: 'device-1',
          deviceSecret: 'secret-1',
        })
      );
    });

    it('includes optional Cloudflare headers', async () => {
      (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);

      await saveCredentials({
        baseUrl: 'https://api.example.com',
        deviceId: 'device-1',
        deviceSecret: 'secret-1',
        cfAccessClientId: 'client-id',
        cfAccessClientSecret: 'client-secret',
      });

      expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
        'jasper_credentials',
        expect.stringContaining('"cfAccessClientId":"client-id"')
      );
    });
  });

  describe('loadCredentials', () => {
    it('returns parsed credentials', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(
        JSON.stringify({
          baseUrl: 'https://api.example.com',
          deviceId: 'device-1',
          deviceSecret: 'secret-1',
        })
      );

      const result = await loadCredentials();

      expect(result).toEqual({
        baseUrl: 'https://api.example.com',
        deviceId: 'device-1',
        deviceSecret: 'secret-1',
      });
    });

    it('returns null when nothing stored', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);

      const result = await loadCredentials();

      expect(result).toBeNull();
    });

    it('returns null on JSON parse error', async () => {
      (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('invalid json');

      const result = await loadCredentials();

      expect(result).toBeNull();
    });
  });

  describe('clearCredentials', () => {
    it('deletes credentials key', async () => {
      (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);

      await clearCredentials();

      expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('jasper_credentials');
    });
  });
});