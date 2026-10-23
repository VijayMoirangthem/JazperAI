/**
 * Disable airplane mode on Android.
 * Requires ADB and a connected device/emulator.
 */
const { execSync } = require('child_process');

try {
  execSync('adb shell settings put global airplane_mode_on 0', { stdio: 'inherit' });
  execSync('adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false', { stdio: 'inherit' });
  console.log('Airplane mode disabled');
} catch (e) {
  console.error('Failed to disable airplane mode:', e.message);
  process.exit(1);
}