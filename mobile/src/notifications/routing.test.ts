import {
  isKnownNotificationType,
  isNotificationEnabled,
  notificationType,
  routeForNotification,
} from './routing';

const allOn = { approvals: true, mail: true, feature: true, alert: true };

describe('notification routing', () => {
  it('routes approvals to the Approvals tab', () => {
    expect(routeForNotification({ type: 'approval', id: 'req-1' })).toBe('/approvals');
  });

  it('routes mail, feature and alert pushes with a slug to that chat', () => {
    expect(routeForNotification({ type: 'mail', slug: 'jasper' })).toBe('/chat/jasper');
    expect(routeForNotification({ type: 'feature', slug: 'forge' })).toBe('/chat/forge');
    expect(routeForNotification({ type: 'alert', slug: 'sentinel' })).toBe('/chat/sentinel');
  });

  it('falls back to the Chats tab for unknown or incomplete data', () => {
    expect(routeForNotification({ type: 'mail' })).toBe('/chats');
    expect(routeForNotification({ type: 'unknown' })).toBe('/chats');
    expect(routeForNotification({})).toBe('/chats');
    expect(routeForNotification(null)).toBe('/chats');
    expect(routeForNotification(undefined)).toBe('/chats');
  });

  it('reads the type from notification data', () => {
    expect(notificationType({ type: 'approval' })).toBe('approval');
    expect(notificationType({ type: 'mail' })).toBe('mail');
    expect(notificationType({ type: 7 })).toBeNull();
    expect(notificationType('approval')).toBeNull();
  });

  it('knows the notification types with toggles', () => {
    expect(isKnownNotificationType('approval')).toBe(true);
    expect(isKnownNotificationType('mail')).toBe(true);
    expect(isKnownNotificationType('other')).toBe(false);
  });

  it('respects the settings toggle for each type', () => {
    expect(isNotificationEnabled('approval', { ...allOn, approvals: false })).toBe(false);
    expect(isNotificationEnabled('mail', { ...allOn, mail: false })).toBe(false);
    expect(isNotificationEnabled('feature', { ...allOn, feature: false })).toBe(false);
    expect(isNotificationEnabled('alert', { ...allOn, alert: false })).toBe(false);
    expect(isNotificationEnabled('approval', allOn)).toBe(true);
  });

  it('keeps unknown and missing types enabled', () => {
    expect(isNotificationEnabled('other', allOn)).toBe(true);
    expect(isNotificationEnabled(null, allOn)).toBe(true);
  });
});
