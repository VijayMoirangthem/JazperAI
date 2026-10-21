import { Stack } from 'expo-router';

export default function RootLayout() {
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