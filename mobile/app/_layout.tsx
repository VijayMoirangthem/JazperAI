import { Stack } from 'expo-router';
import { useAuth } from '@/auth/useAuth';

export default function RootLayout() {
  const { hydrated } = useAuth();

  if (!hydrated) {
    return null;
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