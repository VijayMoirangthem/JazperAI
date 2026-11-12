import { Platform } from 'react-native';
import {
  PairRequest,
  PairResponse,
  RefreshRequest,
  RefreshResponse,
  MeResponse,
  BotListResponse,
  BotCardResponse,
  StatusResponse,
  ApprovalsResponse,
  ApprovalRequest,
  RespondRequest,
  RespondResponse,
  CommsThreadsResponse,
  CommsThreadMessagesResponse,
  NotificationsResponse,
  EventsResponse,
  ChatStreamRequest,
  VoiceTranscribeResponse,
  PushRegisterRequest,
  PushRegisterResponse,
  StoredCredentials,
  Bot,
  ConnectorsResponse,
} from '@/api/types';

export class AuthRevokedError extends Error {
  constructor() {
    super('Authentication revoked');
    this.name = 'AuthRevokedError';
  }
}

export class RateLimitError extends Error {
  constructor() {
    super('Rate limit exceeded');
    this.name = 'RateLimitError';
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function validateBaseUrl(baseUrl: string): void {
  const isDev = __DEV__ === true;
  const allowedDevHosts = ['http://10.0.2.2', 'http://localhost'];
  if (!baseUrl.startsWith('https://') && !allowedDevHosts.some((h) => baseUrl.startsWith(h))) {
    throw new Error('Base URL must be HTTPS (or http://10.0.2.2 / http://localhost in dev)');
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export class JasperClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshPromise: Promise<string> | null = null;
  private extraHeaders: Record<string, string> = {};

  constructor(baseUrl: string, accessToken?: string, extraHeaders?: Record<string, string>) {
    validateBaseUrl(baseUrl);
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.accessToken = accessToken ?? null;
    // ngrok free tunnels show a browser warning page unless this header is present.
    this.extraHeaders = { 'ngrok-skip-browser-warning': '1', ...(extraHeaders ?? {}) };
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  setExtraHeaders(headers: Record<string, string>): void {
    this.extraHeaders = { 'ngrok-skip-browser-warning': '1', ...headers };
  }

  private async refreshToken(deviceId: string, deviceSecret: string): Promise<string> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      const response = await fetch(`${this.baseUrl}/remote/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.extraHeaders,
        },
        body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret } satisfies RefreshRequest),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthRevokedError();
        }
        throw new HttpError(response.status, 'Token refresh failed');
      }

      const data = (await response.json()) as RefreshResponse;
      this.accessToken = data.access_token;
      return data.access_token;
    })();

    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    requiresAuth = true,
    deviceCredentials?: { deviceId: string; deviceSecret: string }
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
      ...(options.headers as Record<string, string>),
    };

    if (requiresAuth && this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers,
    });

    if (response.status === 401 && requiresAuth && deviceCredentials) {
      try {
        await this.refreshToken(deviceCredentials.deviceId, deviceCredentials.deviceSecret);
      } catch {
        throw new AuthRevokedError();
      }
      if (this.accessToken) {
        headers['Authorization'] = `Bearer ${this.accessToken}`;
        const retryResponse = await fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers,
        });
        if (!retryResponse.ok) {
          throw await this.errorFromResponse(retryResponse);
        }
        return retryResponse.json() as Promise<T>;
      }
      throw new AuthRevokedError();
    }

    if (response.status === 429) {
      await new Promise((r) => setTimeout(r, 2000));
      const retryResponse = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
      });
      if (!retryResponse.ok) {
        throw await this.errorFromResponse(retryResponse);
      }
      return retryResponse.json() as Promise<T>;
    }

    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async errorFromResponse(response: Response): Promise<Error> {
    let detail: string | undefined;
    try {
      const data = await response.json();
      detail = data.detail;
    } catch {
      detail = response.statusText;
    }
    if (response.status === 401) return new AuthRevokedError();
    if (response.status === 429) return new RateLimitError();
    return new HttpError(response.status, `HTTP ${response.status}`, detail);
  }

  async pair(body: PairRequest): Promise<PairResponse> {
    return this.request<PairResponse>('/remote/v1/pair/complete', {
      method: 'POST',
      body: JSON.stringify(body),
    }, false);
  }

  async refresh(deviceId: string, deviceSecret: string): Promise<RefreshResponse> {
    return this.request<RefreshResponse>('/remote/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret } satisfies RefreshRequest),
    }, false);
  }

  async me(deviceCredentials: { deviceId: string; deviceSecret: string }): Promise<MeResponse> {
    return this.request<MeResponse>('/remote/v1/me', {}, true, deviceCredentials);
  }

  async getBots(deviceCredentials: { deviceId: string; deviceSecret: string }): Promise<BotListResponse> {
    return this.request<BotListResponse>('/remote/v1/bots', {}, true, deviceCredentials);
  }

  async getBotCard(slug: string, deviceCredentials: { deviceId: string; deviceSecret: string }): Promise<BotCardResponse> {
    return this.request<BotCardResponse>(`/remote/v1/bots/${encodeURIComponent(slug)}/card`, {}, true, deviceCredentials);
  }

  async getStatus(deviceCredentials: { deviceId: string; deviceSecret: string }): Promise<StatusResponse> {
    return this.request<StatusResponse>('/remote/v1/status', {}, true, deviceCredentials);
  }

  async getApprovals(deviceCredentials: { deviceId: string; deviceSecret: string }): Promise<ApprovalsResponse> {
    return this.request<ApprovalsResponse>('/remote/v1/approvals', {}, true, deviceCredentials);
  }

  async respondApproval(
    requestId: string,
    body: RespondRequest,
    deviceCredentials: { deviceId: string; deviceSecret: string }
  ): Promise<RespondResponse> {
    return this.request<RespondResponse>(`/remote/v1/approvals/${encodeURIComponent(requestId)}/respond`, {
      method: 'POST',
      body: JSON.stringify(body),
    }, true, deviceCredentials);
  }

  async getCommsThreads(deviceCredentials: { deviceId: string; deviceSecret: string }): Promise<CommsThreadsResponse> {
    return this.request<CommsThreadsResponse>('/remote/v1/comms/threads', {}, true, deviceCredentials);
  }

  async getCommsThread(
    id: string,
    sinceId: number,
    deviceCredentials: { deviceId: string; deviceSecret: string }
  ): Promise<CommsThreadMessagesResponse> {
    return this.request<CommsThreadMessagesResponse>(
      `/remote/v1/comms/thread?id=${encodeURIComponent(id)}&since_id=${sinceId}`,
      {},
      true,
      deviceCredentials
    );
  }

  async getNotifications(deviceCredentials: { deviceId: string; deviceSecret: string }): Promise<NotificationsResponse> {
    return this.request<NotificationsResponse>('/remote/v1/notifications', {}, true, deviceCredentials);
  }

  /** Long-poll: resolves as soon as the PC has something new, or after `wait` seconds with no events. Omit `since` for a first cursor. */
  async getEvents(
    since: string | null,
    deviceCredentials: { deviceId: string; deviceSecret: string },
    wait = 25,
    signal?: AbortSignal
  ): Promise<EventsResponse> {
    const q = since ? `?since=${encodeURIComponent(since)}&wait=${wait}` : '';
    return this.request<EventsResponse>(`/remote/v1/events${q}`, { signal }, true, deviceCredentials);
  }

  async streamChat(
    body: ChatStreamRequest,
    deviceCredentials: { deviceId: string; deviceSecret: string },
    signal?: AbortSignal
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.extraHeaders,
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    return fetch(`${this.baseUrl}/remote/v1/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
  }

  async transcribeVoice(
    audio: Blob,
    deviceCredentials: { deviceId: string; deviceSecret: string }
  ): Promise<VoiceTranscribeResponse> {
    const formData = new FormData();
    formData.append('audio', audio);

    const response = await this.fetchWithRenewal(
      `${this.baseUrl}/remote/v1/voice/transcribe`,
      () => ({ method: 'POST', body: formData }),
      deviceCredentials
    );
    return response.json() as Promise<VoiceTranscribeResponse>;
  }

  async speakVoice(
    text: string,
    voice: string,
    deviceCredentials: { deviceId: string; deviceSecret: string }
  ): Promise<Blob> {
    const headers: Record<string, string> = {
      ...this.extraHeaders,
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const response = await fetch(
      `${this.baseUrl}/remote/v1/voice/speak?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`,
      {
        headers,
      }
    );

    if (!response.ok) {
      throw await this.errorFromResponse(response);
    }
    return response.blob();
  }

  /**
   * The audio for one piece of text as raw bytes. Uses `response.arrayBuffer()`: React Native's Blob has no `arrayBuffer()`
   * (calling it threw, so no reply was ever played), while Response.arrayBuffer() is supported.
   */
  async speakVoiceBytes(
    text: string,
    voice: string,
    deviceCredentials: { deviceId: string; deviceSecret: string }
  ): Promise<Uint8Array> {
    const url = `${this.baseUrl}/remote/v1/voice/speak?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(voice)}`;
    const response = await this.fetchWithRenewal(url, () => ({}), deviceCredentials);
    return new Uint8Array(await response.arrayBuffer());
  }

  /** A plain fetch that renews the 15-minute access token once on a 401 (calls that bypass `request()` did not, and failed after 15 minutes). */
  private async fetchWithRenewal(
    url: string,
    init: () => RequestInit,
    deviceCredentials: { deviceId: string; deviceSecret: string }
  ): Promise<Response> {
    const attempt = () => {
      const base = init();
      const headers: Record<string, string> = { ...this.extraHeaders, ...((base.headers as Record<string, string>) ?? {}) };
      if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
      return fetch(url, { ...base, headers });
    };
    let response = await attempt();
    if (response.status === 401) {
      try {
        await this.refreshToken(deviceCredentials.deviceId, deviceCredentials.deviceSecret);
      } catch {
        throw new AuthRevokedError();
      }
      response = await attempt();
    }
    if (!response.ok) throw await this.errorFromResponse(response);
    return response;
  }

  async devSignin(body: { name: string; platform: string; push_token?: string }): Promise<PairResponse> {
    return this.request<PairResponse>('/remote/v1/auth/dev-signin', { method: 'POST', body: JSON.stringify(body) }, false);
  }

  async createBot(
    body: { display_name: string; role_title?: string; instructions?: string; look?: { body: string; color: string } },
    creds: { deviceId: string; deviceSecret: string }
  ): Promise<Bot> {
    return this.request<Bot>('/remote/v1/bots', { method: 'POST', body: JSON.stringify(body) }, true, creds);
  }

  async putLook(slug: string, look: { body: string; color: string }, creds: { deviceId: string; deviceSecret: string }): Promise<void> {
    await this.request<unknown>('/remote/v1/bots/' + encodeURIComponent(slug) + '/look', { method: 'PUT', body: JSON.stringify(look) }, true, creds);
  }

  async patchBot(
    slug: string,
    body: { display_name?: string; role_title?: string },
    creds: { deviceId: string; deviceSecret: string }
  ): Promise<void> {
    await this.request<unknown>('/remote/v1/bots/' + encodeURIComponent(slug), { method: 'PATCH', body: JSON.stringify(body) }, true, creds);
  }

  async archiveBot(slug: string, creds: { deviceId: string; deviceSecret: string }): Promise<void> {
    await this.request<unknown>('/remote/v1/bots/' + encodeURIComponent(slug), { method: 'DELETE' }, true, creds);
  }

  async getConnectors(creds: { deviceId: string; deviceSecret: string }): Promise<ConnectorsResponse> {
    return this.request<ConnectorsResponse>('/remote/v1/connectors', {}, true, creds);
  }

  async requestConnector(id: string, creds: { deviceId: string; deviceSecret: string }): Promise<void> {
    await this.request<unknown>('/remote/v1/connectors/' + encodeURIComponent(id) + '/request', { method: 'POST' }, true, creds);
  }

  async registerPushToken(
    token: string,
    deviceCredentials: { deviceId: string; deviceSecret: string }
  ): Promise<PushRegisterResponse> {
    return this.request<PushRegisterResponse>('/remote/v1/push/register', {
      method: 'POST',
      body: JSON.stringify({ token } satisfies PushRegisterRequest),
    }, true, deviceCredentials);
  }
}