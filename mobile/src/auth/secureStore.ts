import * as SecureStore from 'expo-secure-store';
import { StoredCredentials } from '@/api/types';

const KEYS = {
  CREDENTIALS: 'jasper_credentials',
} as const;

export async function saveCredentials(credentials: StoredCredentials): Promise<void> {
  await SecureStore.setItemAsync(KEYS.CREDENTIALS, JSON.stringify(credentials));
}

export async function loadCredentials(): Promise<StoredCredentials | null> {
  const stored = await SecureStore.getItemAsync(KEYS.CREDENTIALS);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as StoredCredentials;
  } catch {
    return null;
  }
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.CREDENTIALS);
}

export async function saveAccessToken(token: string): Promise<void> {
  await SecureStore.setItemAsync('jasper_access_token', token);
}

export async function loadAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync('jasper_access_token');
}

export async function clearAccessToken(): Promise<void> {
  await SecureStore.deleteItemAsync('jasper_access_token');
}