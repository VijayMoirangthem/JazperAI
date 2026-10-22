export interface PairRequest {
  code: string;
  name: string;
  platform: string;
  push_token?: string;
  cf_access_client_id?: string;
  cf_access_client_secret?: string;
}

export interface PairResponse {
  device_id: string;
  device_secret: string;
  access_token: string;
  expires_in: number;
}

export interface RefreshRequest {
  device_id: string;
  device_secret: string;
}

export interface RefreshResponse {
  access_token: string;
  expires_in: number;
}

export interface MeResponse {
  device_id: string;
  name: string;
}

export interface BotListResponse {
  groups: BotGroup[];
}

export interface BotGroup {
  id: string;
  label: string;
  bots: Bot[];
}

export interface Bot {
  slug: string;
  display_name: string;
  position: string;
  department: string;
  enabled: boolean;
  score: number | null;
  grade: string;
}

export interface BotCardResponse {
  slug: string;
  display_name: string;
  role_title: string;
  position: string;
  department: string;
  group: string;
  group_label: string;
  reports_to: string;
  created_at: string;
  started_at: string;
  lifecycle: string;
  enabled: boolean;
  source: string;
  tier: number;
  tools: string[];
  memory_namespace: string;
  calls: number;
  errors: number;
  thumbs_up: number;
  thumbs_down: number;
  avg_latency_ms: number;
  last_active_at: string;
  score: number | null;
  grade: string;
  settings: Record<string, unknown>;
}

export interface StatusResponse {
  slos: SLO[];
  pending_approvals: number;
}

export interface SLO {
  slo: string;
  target: number;
  sli: number;
  events: number;
  bad: number;
  budget_remaining: number;
  status: 'ok' | 'breached' | 'no-data';
}

export interface ApprovalsResponse {
  requests: ApprovalRequest[];
}

export interface ApprovalRequest {
  request_id: string;
  tier: number;
  action: string;
  summary: string;
  requester: string;
  created_at: string;
}

export interface RespondRequest {
  approve: boolean;
  confirm?: string;
}

export interface RespondResponse {
  resolved: boolean;
}

export interface CommsThreadsResponse {
  threads: CommsThread[];
}

export interface CommsThread {
  thread: string;
  from_slug: string;
  to_slug: string;
  kind: string;
  preview: string;
  ts: string;
  n: number;
}

export interface CommsThreadMessagesResponse {
  messages: CommsMessage[];
}

export interface CommsMessage {
  id: number;
  ts: string;
  from_slug: string;
  to_slug: string;
  kind: 'ask' | 'reply' | 'tool' | 'result' | 'message' | 'conclusion';
  text: string;
}

export interface NotificationsResponse {
  unread: number | null;
}

export interface ChatStreamRequest {
  text: string;
  slug: string;
  history: ChatHistoryItem[];
  attachments: Attachment[];
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface Attachment {
  name: string;
  mime: string;
  text?: string;
  uri?: string;
}

export interface VoiceTranscribeResponse {
  text: string;
}

export interface PushRegisterRequest {
  token: string;
}

export interface PushRegisterResponse {
  ok: true;
}

export type ChatEvent =
  | { t: 'speaker'; slug: string }
  | { t: 'delta'; slug: string; text: string }
  | { t: 'tool'; slug: string; name: string; label: string; status: 'running' | 'ok' | 'error'; result?: unknown; untrusted?: boolean }
  | { t: 'ui'; slug: string; kind: 'credentials' | 'oauth' | 'suggestions'; connector: string; items?: { name: string; why: string; status: string }[] }
  | { t: 'phase'; text: string }
  | { t: 'route'; slugs: string[]; source: string; confidence: number }
  | { t: 'done'; slug: string; usage: Record<string, unknown> }
  | { t: 'error'; slug?: string; message: string }
  | { t: string; [k: string]: unknown };

export interface StoredCredentials {
  baseUrl: string;
  deviceId: string;
  deviceSecret: string;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}