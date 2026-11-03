import React, { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Href, useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, CameraView, BarcodeScanningResult } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, ScanLine } from 'lucide-react-native';
import { isValidPairingCode, normalizeServerUrl, pairWithCode, parsePairLink } from '@/auth/AuthProvider';
import { Button } from '@/components/ui';
import { CircleButton } from '@/components/ui/kit';
import { theme } from '@/theme/tokens';

function isAllowedUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://10.0.2.2') || url.startsWith('http://localhost');
}

/** Connect to Jasper through the internet link: scan the QR on the computer, or type the address and code. */
export default function PairScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ u?: string; c?: string }>();
  const [serverUrl, setServerUrl] = useState('');
  const [code, setCode] = useState('');
  const [cfId, setCfId] = useState('');
  const [cfSecret, setCfSecret] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  const submit = useCallback(
    async (urlInput: string, codeInput: string) => {
      const url = normalizeServerUrl(urlInput);
      if (!url) return setError('Enter the address shown on your computer.');
      if (!isAllowedUrl(url)) return setError('The address must start with https://');
      if (!isValidPairingCode(codeInput)) return setError('The code has 8 letters and numbers.');
      setBusy(true);
      setError(null);
      try {
        await pairWithCode({ baseUrl: url, code: codeInput, cfClientId: cfId.trim(), cfClientSecret: cfSecret.trim() });
        router.replace('/(tabs)/chats' as Href);
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        if (/400|invalid or expired/i.test(message)) setError('That code is invalid or has expired. Make a new one on your computer.');
        else setError("Can't reach Jasper at that address. Is it running and is the link still open?");
      } finally {
        setBusy(false);
      }
    },
    [cfId, cfSecret, router]
  );

  // Opened from a link or QR: fill the fields and connect straight away.
  useEffect(() => {
    if (autoRan.current || !params.u || !params.c) return;
    autoRan.current = true;
    const url = decodeURIComponent(String(params.u));
    const pairCode = String(params.c).toUpperCase();
    setServerUrl(url);
    setCode(pairCode);
    void submit(url, pairCode);
  }, [params.u, params.c, submit]);

  const startScan = async () => {
    const permission = await Camera.requestCameraPermissionsAsync();
    if (!permission.granted) return setError('Allow the camera to scan the QR code, or type the details below.');
    setScanning(true);
  };

  const onScanned = (result: BarcodeScanningResult) => {
    const parsed = parsePairLink(result.data);
    if (!parsed) return;
    setScanning(false);
    setServerUrl(parsed.url);
    setCode(parsed.code);
    void submit(parsed.url, parsed.code);
  };

  if (scanning) {
    return (
      <View style={styles.scan}>
        <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScanned} />
        <View style={[styles.scanTop, { top: insets.top + 8 }]}>
          <CircleButton label="Close scanner" onPress={() => setScanning(false)}>
            <ChevronLeft size={22} color={theme.colors.text} />
          </CircleButton>
        </View>
        <Text style={[styles.scanHint, { bottom: insets.bottom + 40 }]}>Point the camera at the QR code on your computer</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <CircleButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={22} color={theme.colors.text} />
        </CircleButton>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">
          Connect to Jasper
        </Text>
        <Text style={styles.sub}>On your computer run the Jasper phone link, then scan its QR code. Works from anywhere.</Text>

        <Pressable onPress={startScan} style={styles.scanButton} accessibilityRole="button" accessibilityLabel="Scan QR code">
          <ScanLine size={20} color={theme.colors.pillText} />
          <Text style={styles.scanButtonText}>Scan QR code</Text>
        </Pressable>

        <Text style={styles.or}>or type it in</Text>
        <TextInput
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder="Address, for example https://abc.trycloudflare.com"
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.field}
          accessibilityLabel="Server address"
        />
        <TextInput
          value={code}
          onChangeText={(text) => setCode(text.toUpperCase())}
          placeholder="8-character code"
          placeholderTextColor={theme.colors.faint}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          style={[styles.field, styles.codeField]}
          accessibilityLabel="Pairing code"
        />

        <Pressable onPress={() => setAdvanced((v) => !v)} style={styles.advanced} accessibilityRole="button" accessibilityLabel="Advanced">
          <Text style={styles.advancedText}>Advanced</Text>
          <ChevronDown size={16} color={theme.colors.muted} style={{ transform: [{ rotate: advanced ? '180deg' : '0deg' }] }} />
        </Pressable>
        {advanced ? (
          <View style={{ gap: 10 }}>
            <TextInput value={cfId} onChangeText={setCfId} placeholder="Cloudflare Access client id (optional)" placeholderTextColor={theme.colors.faint} autoCapitalize="none" style={styles.field} accessibilityLabel="Cloudflare Access client id" />
            <TextInput value={cfSecret} onChangeText={setCfSecret} placeholder="Cloudflare Access client secret (optional)" placeholderTextColor={theme.colors.faint} autoCapitalize="none" secureTextEntry style={styles.field} accessibilityLabel="Cloudflare Access client secret" />
          </View>
        ) : null}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button title="Connect" onPress={() => void submit(serverUrl, code)} loading={busy} disabled={!serverUrl || code.length < 8} style={{ height: 52, marginTop: 6 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  top: { paddingHorizontal: 14, paddingBottom: 4 },
  content: { padding: 20, gap: 14 },
  title: { fontSize: theme.fontSizes.hero - 6, fontWeight: '600', color: theme.colors.text, marginTop: 6 },
  sub: { fontSize: theme.fontSizes.base, color: theme.colors.muted, lineHeight: 21 },
  scanButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, height: 54, borderRadius: 27, backgroundColor: theme.colors.pill, marginTop: 8 },
  scanButtonText: { color: theme.colors.pillText, fontWeight: '600', fontSize: theme.fontSizes.body },
  or: { textAlign: 'center', color: theme.colors.faint, fontSize: theme.fontSizes.sm },
  field: { height: 52, borderRadius: 16, backgroundColor: theme.colors.chipBg, paddingHorizontal: 16, fontSize: theme.fontSizes.body, color: theme.colors.text },
  codeField: { letterSpacing: 4, fontWeight: '600', textAlign: 'center' },
  advanced: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', paddingVertical: 4 },
  advancedText: { fontSize: theme.fontSizes.sm, color: theme.colors.muted },
  error: { color: theme.colors.danger, fontSize: theme.fontSizes.sm, textAlign: 'center' },
  scan: { flex: 1, backgroundColor: '#000000' },
  scanTop: { position: 'absolute', left: 14 },
  scanHint: { position: 'absolute', alignSelf: 'center', color: '#ffffff', fontSize: theme.fontSizes.base, textAlign: 'center', paddingHorizontal: 30 },
});
