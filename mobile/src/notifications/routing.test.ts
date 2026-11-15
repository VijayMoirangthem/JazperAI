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

import { actionForResponse } from './routing';

describe('notification button actions', () => {
  const data = (tier: number) => ({ type: 'approval', id: 'req-9', tier });

  it('Reject answers the request at any tier', () => {
    expect(actionForResponse('reject', data(2))).toEqual({ kind: 'respond', id: 'req-9', tier: 2, approve: false });
    expect(actionForResponse('reject', data(3))).toEqual({ kind: 'respond', id: 'req-9', tier: 3, approve: false });
  });

  it('Approve answers only Tier 2; Tier 3 must go through the fingerprint prompt in the app', () => {
    expect(actionForResponse('approve', data(2))).toEqual({ kind: 'respond', id: 'req-9', tier: 2, approve: true });
    expect(actionForResponse('approve', data(3))).toEqual({ kind: 'open' });
    expect(actionForResponse('approve', { type: 'approval', id: 'req-9' })).toEqual({ kind: 'open' });   // unknown tier counts as Tier 3
  });

  it('a plain tap, Review, other types or a missing id just open the app', () => {
    expect(actionForResponse('expo.modules.notifications.actions.DEFAULT', data(2))).toEqual({ kind: 'open' });
    expect(actionForResponse('review', data(3))).toEqual({ kind: 'open' });
    expect(actionForResponse('reject', { type: 'mail', id: 'x' })).toEqual({ kind: 'open' });
    expect(actionForResponse('reject', { type: 'approval' })).toEqual({ kind: 'open' });
    expect(actionForResponse('reject', null)).toEqual({ kind: 'open' });
  });
});
