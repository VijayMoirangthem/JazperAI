import { Tabs } from 'expo-router';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#2563eb',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.55)',
        tabBarStyle: { backgroundColor: '#161616', borderTopWidth: 0 },
      }}
    >
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen name="approvals" options={{ title: 'Approvals' }} />
      <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}