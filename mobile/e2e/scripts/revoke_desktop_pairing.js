/**
 * Revoke the mobile pairing from the desktop backend.
 * This script calls the desktop API to revoke the device credentials.
 * Requires the desktop backend to be running and MAESTRO_URL + MAESTRO_PAIR_CODE
 * to be set (or use stored credentials).
 */
const fetch = require('node-fetch');

async function revokePairing() {
  const baseUrl = process.env.MAESTRO_URL || 'http://10.0.2.2:8000';
  const deviceId = process.env.MAESTRO_DEVICE_ID;
  const deviceSecret = process.env.MAESTRO_DEVICE_SECRET;

  if (!deviceId || !deviceSecret) {
    console.log('No device credentials in env; skipping desktop revoke (simulate by clearing app storage instead)');
    return;
  }

  try {
    const response = await fetch(`${baseUrl}/remote/v1/auth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_id: deviceId, device_secret: deviceSecret }),
    });

    if (response.ok) {
      console.log('Desktop pairing revoked');
    } else {
      console.warn('Failed to revoke on desktop:', response.status, await response.text());
    }
  } catch (e) {
    console.error('Error calling revoke endpoint:', e.message);
  }
}

revokePairing();