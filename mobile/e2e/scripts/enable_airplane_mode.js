/**
 * Enable airplane mode on Android.
 * Requires ADB and a connected device/emulator.
 */
const { execSync } = require('child_process');

try {
  execSync('adb shell settings put global airplane_mode_on 1', { stdio: 'inherit' });
  execSync('adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true', { stdio: 'inherit' });
  console.log('Airplane mode enabled');
} catch (e) {
  console.error('Failed to enable airplane mode:', e.message);
  process.exit(1);
}