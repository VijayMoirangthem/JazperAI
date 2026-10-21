import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/useAuth';
import { loadCredentials, clearCredentials } from '@/auth/secureStore';
import { JasperClient, AuthRevokedError } from '@/api/client';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

export default function RootLayout() {
  const { hydrated, setTokens, setCredentials, clear, setHydrated } = useAuth();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const initialize = async () => {
      if (!hydrated) return;

      const credentials = await loadCredentials();
      if (!credentials) {
        setInitializing(false);
        return;
      }

      try {
        const client = new JasperClient(credentials.baseUrl);
        const refreshResponse = await client.refresh(credentials.deviceId, credentials.deviceSecret);
        const meResponse = await client.me({ deviceId: credentials.deviceId, deviceSecret: credentials.deviceSecret });

        setCredentials(credentials);
        setTokens(refreshResponse.access_token, credentials.deviceId, meResponse.name);
      } catch (err) {
        if (err instanceof AuthRevokedError || (err instanceof Error && err.message.includes('401'))) {
          await clearCredentials();
          clear();
        }
      } finally {
        setInitializing(false);
      }
    };

    initialize();
  }, [hydrated, setTokens, setCredentials, clear]);

  if (initializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="(auth)/pair" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="chat/[slug]" />
      <Stack.Screen name="bot/[slug]" />
      <Stack.Screen name="thread/[id]" />
    </Stack>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0b0b0b',
    justifyContent: 'center',
    alignItems: 'center',
  },
});