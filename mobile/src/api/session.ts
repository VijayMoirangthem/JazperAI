import { JasperClient } from '@/api/client';
import { useAuth } from '@/auth/useAuth';

export interface DeviceCreds {
  deviceId: string;
  deviceSecret: string;
}

let cached: { key: string; client: JasperClient } | null = null;

/** The signed-in client (reused so a refreshed token is kept) and the device credentials, or null when signed out. */
export function getSession(): { client: JasperClient; creds: DeviceCreds } | null {
  const { credentials, accessToken } = useAuth.getState();
  if (!credentials) return null;
  const key = `${credentials.baseUrl}|${credentials.deviceId}`;
  if (!cached || cached.key !== key) {
    const headers: Record<string, string> = {};
    if (credentials.cfAccessClientId) headers['CF-Access-Client-Id'] = credentials.cfAccessClientId;
    if (credentials.cfAccessClientSecret) headers['CF-Access-Client-Secret'] = credentials.cfAccessClientSecret;
    cached = { key, client: new JasperClient(credentials.baseUrl, accessToken ?? undefined, headers) };
  }
  return { client: cached.client, creds: { deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret } };
}

export function resetSession(): void {
  cached = null;
}
