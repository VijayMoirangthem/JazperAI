import { safeStorage } from "./storage";

const sessionKey = "office3.person-session";

export type OfficePersonSession = {
  accessToken: string;
  personId: string;
  role: string;
  expiresAt: number;
};

const valid = (value: unknown): value is OfficePersonSession => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.accessToken === "string" && item.accessToken.length > 20 && typeof item.personId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(item.personId) && typeof item.role === "string" && Number.isFinite(item.expiresAt);
};

export const loadOfficePersonSession = (): OfficePersonSession | null => {
  try {
    const parsed = JSON.parse(safeStorage.get(sessionKey) ?? "null");
    if (!valid(parsed) || parsed.expiresAt <= Date.now()) { safeStorage.remove(sessionKey); return null; }
    return parsed;
  } catch { return null; }
};

export const saveOfficePersonSession = (value: { access_token: string; expires_in: number; person: { id: string; role: string } }): OfficePersonSession => {
  const session: OfficePersonSession = { accessToken: value.access_token, personId: value.person.id, role: value.person.role, expiresAt: Date.now() + Math.max(1, value.expires_in) * 1000 };
  safeStorage.set(sessionKey, JSON.stringify(session));
  return session;
};

export const clearOfficePersonSession = (): void => { safeStorage.remove(sessionKey); };

export const officePersonAuthHeaders = (): Record<string, string> => {
  const session = loadOfficePersonSession();
  return session ? { Authorization: `Bearer ${session.accessToken}` } : {};
};
