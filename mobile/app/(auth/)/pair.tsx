import { View, Text, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert, TextInput } from 'react-native';
import React, { useState, useEffect, useRef } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as Constants from 'expo-constants';
import Camera, { CameraView, BarcodeScanningResult } from 'expo-camera';
import { useAuth } from '@/auth/useAuth';
import { saveCredentials } from '@/auth/secureStore';
import { JasperClient, AuthRevokedError } from '@/api/client';
import { StoredCredentials } from '@/api/types';
import {
  Screen,
  Text as UISText,
  Button,
  Card,
  Divider,
  Spinner,
} from '@/components/ui';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function isValidPairingCode(code: string): boolean {
  if (code.length !== 8) return false;
  return code.toUpperCase().split('').every((c) => ALPHABET.includes(c));
}

function isValidUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://10.0.2.2') || url.startsWith('http://localhost');
}

// Workaround for TypeScript: expo-camera exports these at runtime but types don't match
// @ts-ignore
const requestCameraPermissionsAsync = Camera.requestCameraPermissionsAsync;

export default function PairScreen() {
  const router = useRouter();
  const { setTokens, setCredentials } = useAuth();
  const { u, c } = useLocalSearchParams();

  const [serverUrl, setServerUrl] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [cfClientId, setCfClientId] = useState('');
  const [cfClientSecret, setCfClientSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<null | boolean>(null);

  const scannedCodeRef = useRef<string | null>(null);

  // Initialize default name and URL from QR params
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const defaultName = (Constants.default as { deviceName?: string })?.deviceName ?? 'Jasper Phone';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDeviceName(defaultName);

    if (u && c) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setServerUrl(u as string);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPairingCode((c as string).toUpperCase());
    }
  }, [u, c]);

  // Request camera permissions
  useEffect(() => {
    (async () => {
      const { status } = await requestCameraPermissionsAsync();
      setHasCameraPermission(status === 'granted');
    })();
  }, []);

  const handlePair = async () => {
    setError(null);

    if (!serverUrl.trim()) {
      setError('Server URL is required');
      return;
    }
    if (!isValidUrl(serverUrl)) {
      setError('Server URL must start with https:// (or http://10.0.2.2 / http://localhost in dev)');
      return;
    }
    if (!pairingCode.trim()) {
      setError('Pairing code is required');
      return;
    }
    if (!isValidPairingCode(pairingCode)) {
      setError('Pairing code must be 8 characters (A-Z except I,O and 2-9)');
      return;
    }

    setLoading(true);

    try {
      const client = new JasperClient(serverUrl);
      const defaultName = (Constants.default as { deviceName?: string })?.deviceName ?? 'Jasper Phone';
      const response = await client.pair({
        code: pairingCode.toUpperCase(),
        name: deviceName.trim() || defaultName,
        platform: Platform.OS,
        cf_access_client_id: cfClientId.trim() || undefined,
        cf_access_client_secret: cfClientSecret.trim() || undefined,
      });

      const credentials: StoredCredentials = {
        baseUrl: serverUrl,
        deviceId: response.device_id,
        deviceSecret: response.device_secret,
        cfAccessClientId: cfClientId.trim() || undefined,
        cfAccessClientSecret: cfClientSecret.trim() || undefined,
      };

      await saveCredentials(credentials);
      setCredentials(credentials);
      setTokens(response.access_token, response.device_id, deviceName.trim() || defaultName);

      router.replace('/(tabs)/chats' as any);
    } catch (err) {
      if (err instanceof AuthRevokedError || err instanceof Error) {
        if (err.message.includes('invalid or expired') || err.message.includes('400')) {
          setError('Invalid or expired pairing code');
        } else if (err.message.includes('network') || err.message.includes('fetch')) {
          setError('Cannot reach server. Check the URL and your connection.');
        } else {
          setError(err.message);
        }
      } else {
        setError('An unexpected error occurred');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleScanQR = () => {
    if (hasCameraPermission) {
      setScanning(true);
    } else {
      Alert.alert('Camera permission required', 'Please grant camera access to scan QR codes.');
    }
  };

  const handleBarCodeScanned = (result: BarcodeScanningResult) => {
    const barcodeData = result.data;
    if (!barcodeData || scannedCodeRef.current === barcodeData) return;
    scannedCodeRef.current = barcodeData;

    try {
      const url = new URL(barcodeData);
      if (url.protocol === 'jasper:' && url.pathname === '/pair') {
        const uParam = url.searchParams.get('u');
        const cParam = url.searchParams.get('c');
        if (uParam && cParam) {
          setServerUrl(uParam);
          setPairingCode(cParam.toUpperCase());
          setScanning(false);
          return;
        }
      }
    } catch {
      // Not a valid URL
    }
    Alert.alert('Invalid QR code', 'This QR code does not contain a valid Jasper pairing link.');
  };

  if (scanning && hasCameraPermission) {
    return (
      <Screen style={styles.scannerContainer}>
        <CameraView
          style={StyleSheet.absoluteFill}
          onBarcodeScanned={handleBarCodeScanned}
        />
        <View style={styles.scannerOverlay}>
          <UISText variant="title" style={styles.scannerTitle}>
            Scan Pairing QR Code
          </UISText>
          <UISText variant="body" style={styles.scannerHint}>
            Point camera at the QR code from the desktop app
          </UISText>
          <Button title="Cancel" variant="secondary" onPress={() => setScanning(false)} style={styles.scannerButton} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <UISText variant="title" style={styles.title}>
              Pair with Jasper
            </UISText>
            <UISText variant="muted" style={styles.subtitle}>
              Enter the pairing code from your desktop app
            </UISText>
          </View>

          <Card style={styles.card}>
            <UISText variant="caption" style={styles.fieldLabel}>
              Server URL
            </UISText>
            <TextInput
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://your-tunnel.trycloudflare.com"
              autoCapitalize="none"
              autoComplete="url"
              keyboardType="url"
              style={styles.textInput}
              editable={!loading}
            />

            <Divider style={styles.divider} />

            <UISText variant="caption" style={styles.fieldLabel}>
              Pairing Code
            </UISText>
            <TextInput
              value={pairingCode}
              onChangeText={(t) => setPairingCode(t.toUpperCase())}
              placeholder="ABCD1234"
              autoCapitalize="characters"
              maxLength={8}
              style={styles.textInput}
              editable={!loading}
            />

            <Divider style={styles.divider} />

            <UISText variant="caption" style={styles.fieldLabel}>
              Device Name
            </UISText>
            <TextInput
              value={deviceName}
              onChangeText={setDeviceName}
              placeholder="My Phone"
              autoCapitalize="words"
              style={styles.textInput}
              editable={!loading}
            />
          </Card>

          <Button
            title="Scan QR Code"
            variant="secondary"
            onPress={handleScanQR}
            disabled={loading || !hasCameraPermission}
            style={styles.scanButton}
          />

          <Button
            title={showAdvanced ? 'Hide Advanced' : 'Show Advanced'}
            variant="secondary"
            onPress={() => setShowAdvanced(!showAdvanced)}
            disabled={loading}
            style={styles.advancedToggle}
          />

          {showAdvanced && (
            <Card style={styles.advancedCard}>
              <UISText variant="caption" style={styles.fieldLabel}>
                Cloudflare Access Client ID (optional)
              </UISText>
              <TextInput
                value={cfClientId}
                onChangeText={setCfClientId}
                placeholder="client-id"
                autoCapitalize="none"
                style={styles.textInput}
                editable={!loading}
              />

              <Divider style={styles.divider} />

              <UISText variant="caption" style={styles.fieldLabel}>
                Cloudflare Access Client Secret (optional)
              </UISText>
              <TextInput
                value={cfClientSecret}
                onChangeText={setCfClientSecret}
                placeholder="client-secret"
                autoCapitalize="none"
                secureTextEntry
                style={styles.textInput}
                editable={!loading}
              />
            </Card>
          )}

          {error && (
            <Card style={styles.errorCard}>
              <UISText variant="body" style={styles.errorText}>
                {error}
              </UISText>
            </Card>
          )}

          <Button
            title={loading ? 'Pairing...' : 'Pair'}
            variant="primary"
            onPress={handlePair}
            loading={loading}
            disabled={loading}
            style={styles.pairButton}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0b',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 32,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    textAlign: 'center',
    lineHeight: 22,
  },
  card: {
    marginBottom: 16,
  },
  fieldLabel: {
    marginBottom: 8,
    marginTop: 4,
  },
  textInput: {
    backgroundColor: '#1f1f1f',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#f2f2f2',
    fontSize: 16,
  },
  divider: {
    marginVertical: 16,
  },
  scanButton: {
    marginBottom: 12,
  },
  advancedToggle: {
    marginBottom: 12,
  },
  advancedCard: {
    marginBottom: 16,
  },
  errorCard: {
    backgroundColor: 'rgba(239,68,68,0.15)',
    borderColor: '#ef4444',
    marginBottom: 16,
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
  },
  pairButton: {
    marginTop: 8,
  },
  scannerContainer: {
    flex: 1,
  },
  scannerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  scannerTitle: {
    textAlign: 'center',
    marginBottom: 12,
  },
  scannerHint: {
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.8,
  },
  scannerButton: {
    width: 200,
  },
});