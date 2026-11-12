// Jasper's own "push": a small foreground service keeps one request open to the PC (over your private Tailscale link) and shows
// a notification the moment something happens. No Google/Expo/Telegram push service is involved.
// Android 14+ needs the foreground-service type and its permission declared in the manifest. "remoteMessaging" is the type for
// receiving messages from another device and, unlike "dataSync", has no 6-hour runtime limit on Android 15.
const { withAndroidManifest } = require('@expo/config-plugins');

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.WAKE_LOCK',
];
const SERVICE = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';

module.exports = function withBackgroundListener(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    for (const name of PERMISSIONS) {
      if (!manifest['uses-permission'].some((p) => p.$['android:name'] === name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    const app = manifest.application[0];
    app.service = app.service ?? [];
    let svc = app.service.find((s) => s.$['android:name'] === SERVICE);
    if (!svc) {
      svc = { $: { 'android:name': SERVICE } };
      app.service.push(svc);
    }
    svc.$['android:foregroundServiceType'] = 'remoteMessaging';
    svc.$['android:exported'] = 'false';
    return c;
  });
};
