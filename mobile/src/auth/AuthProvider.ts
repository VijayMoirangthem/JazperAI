import { Platform } from 'react-native';
import { AuthRevokedError, JasperClient } from '@/api/client';
import { resetSession } from '@/api/session';
import { StoredCredentials } from '@/api/types';
import { SERVER_URL } from '@/config';
import { clearCredentials, loadCredentials, saveCredentials } from '@/auth/secureStore';
import { useAuth } from '@/auth/useAuth';
import { registerForPushNotifications } from '@/notifications/setup';

export interface Session {
  credentials: StoredCredentials;
  accessToken: string;
  deviceName: string;
}

/**
 * The only thing the rest of the app knows about signing in. Today: one tap on the founder's own computer.
 * Later: real accounts. Swap the implementation returned by `getAuthProvider`.
 */
export interface AuthProvider {
  signIn(): Promise<Session>;
  signOut(): Promise<void>;
  restore(): Promise<Session | null>;
}

const DEVICE_NAME = `Jasper Phone (${Platform.OS})`;

function apply(session: Session): void {
  const { credentials, accessToken, deviceName } = session;
  useAuth.getState().setCredentials(credentials);
  useAuth.getState().setTokens(accessToken, credentials.deviceId, deviceName);
}

export class DevOneTapAuth implements AuthProvider {
  async signIn(): Promise<Session> {
    const client = new JasperClient(SERVER_URL);
    const response = await client.devSignin({ name: DEVICE_NAME, platform: Platform.OS });
    const credentials: StoredCredentials = {
      baseUrl: SERVER_URL,
      deviceId: response.device_id,
      deviceSecret: response.device_secret,
    };
    await saveCredentials(credentials);
    resetSession();
    const session: Session = { credentials, accessToken: response.access_token, deviceName: DEVICE_NAME };
    apply(session);
    void registerForPushNotifications();
    return session;
  }

  async signOut(): Promise<void> {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    await clearCredentials();
    resetSession();
    useAuth.getState().clear();
  }

  async restore(): Promise<Session | null> {
    const credentials = await loadCredentials();
    if (!credentials) return null;
    // The pairing is stored on this phone, so use it straight away. The PC may be asleep, restarting or out of reach when the app
    // opens: the app then opens normally (offline) and keeps trying in the background. Only a definite "this device was removed"
    // (HTTP 401 from the PC) signs out; a network error or a slow PC never does.
    useAuth.getState().setCredentials(credentials);
    try {
      return await signInWithStored(credentials);
    } catch (err) {
      if (err instanceof AuthRevokedError) throw err;
      retryTokenRefresh(credentials);
      return null;
    }
  }
}

async function signInWithStored(credentials: StoredCredentials): Promise<Session> {
  const client = new JasperClient(credentials.baseUrl);
  const refreshed = await client.refresh(credentials.deviceId, credentials.deviceSecret);
  const me = await client.me({ deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret });
  const session: Session = { credentials, accessToken: refreshed.access_token, deviceName: me.name };
  resetSession();
  apply(session);
  return session;
}

let retryTimer: ReturnType<typeof setTimeout> | null = null;
export const REFRESH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

/** Keeps trying to get an access token after a failed start (PC asleep or restarting). Stops on success, sign-out or revocation. */
export function retryTokenRefresh(credentials: StoredCredentials, attempt = 0): void {
  if (retryTimer) clearTimeout(retryTimer);
  if (attempt >= REFRESH_RETRY_DELAYS_MS.length) return;
  retryTimer = setTimeout(async () => {
    retryTimer = null;
    if (useAuth.getState().credentials?.deviceId !== credentials.deviceId) return; // signed out or re-paired meanwhile
    try {
      await signInWithStored(credentials);
    } catch (err) {
      if (err instanceof AuthRevokedError) {
        await getAuthProvider().signOut();
        return;
      }
      retryTokenRefresh(credentials, attempt + 1);
    }
  }, REFRESH_RETRY_DELAYS_MS[attempt]);
}

const provider: AuthProvider = new DevOneTapAuth();

export function getAuthProvider(): AuthProvider {
  return provider;
}

// Pairing with a code (works through the internet tunnel) ---------------------------------------------------
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function isValidPairingCode(code: string): boolean {
  const upper = code.trim().toUpperCase();
  return upper.length === 8 && upper.split('').every((c) => PAIR_ALPHABET.includes(c));
}

/** Reads `jasper://pair?u=<server>&c=<code>` (or an https link with `c=`) from a QR code or deep link. */
export function parsePairLink(text: string): { url: string; code: string } | null {
  const match = /[?&]u=([^&]+)/.exec(text);
  const code = /[?&]c=([A-Za-z0-9]+)/.exec(text);
  if (match && code) return { url: decodeURIComponent(match[1]), code: code[1].toUpperCase() };
  return null;
}

export function normalizeServerUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url;
}

export async function pairWithCode(args: { baseUrl: string; code: string; cfClientId?: string; cfClientSecret?: string }): Promise<Session> {
  const baseUrl = normalizeServerUrl(args.baseUrl);
  const headers: Record<string, string> = {};
  if (args.cfClientId) headers['CF-Access-Client-Id'] = args.cfClientId;
  if (args.cfClientSecret) headers['CF-Access-Client-Secret'] = args.cfClientSecret;
  const client = new JasperClient(baseUrl, undefined, headers);
  const response = await client.pair({
    code: args.code.trim().toUpperCase(),
    name: DEVICE_NAME,
    platform: Platform.OS,
    cf_access_client_id: args.cfClientId || undefined,
    cf_access_client_secret: args.cfClientSecret || undefined,
  });
  const credentials: StoredCredentials = {
    baseUrl,
    deviceId: response.device_id,
    deviceSecret: response.device_secret,
    cfAccessClientId: args.cfClientId || undefined,
    cfAccessClientSecret: args.cfClientSecret || undefined,
  };
  await saveCredentials(credentials);
  resetSession();
  const session: Session = { credentials, accessToken: response.access_token, deviceName: DEVICE_NAME };
  apply(session);
  void registerForPushNotifications();
  return session;
}
