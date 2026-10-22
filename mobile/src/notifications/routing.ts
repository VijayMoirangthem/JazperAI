export type NotificationToggles = {
  approvals: boolean;
  mail: boolean;
  feature: boolean;
  alert: boolean;
};

export type KnownNotificationType = 'approval' | 'mail' | 'feature' | 'alert';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function notificationType(data: unknown): string | null {
  const value = asRecord(data)?.type;
  return typeof value === 'string' ? value : null;
}

export function isKnownNotificationType(type: string): type is KnownNotificationType {
  return type === 'approval' || type === 'mail' || type === 'feature' || type === 'alert';
}

export function isNotificationEnabled(type: string | null, toggles: NotificationToggles): boolean {
  if (!type || !isKnownNotificationType(type)) return true;
  if (type === 'approval') return toggles.approvals;
  return toggles[type];
}

export function routeForNotification(data: unknown): string {
  const type = notificationType(data);
  if (type === 'approval') return '/approvals';

  const slug = asRecord(data)?.slug;
  if (
    (type === 'mail' || type === 'feature' || type === 'alert') &&
    typeof slug === 'string' &&
    slug.length > 0
  ) {
    return `/chat/${encodeURIComponent(slug)}`;
  }

  return '/chats';
}
