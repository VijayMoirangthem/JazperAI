import { useEffect } from 'react';
import { Tabs } from 'expo-router';
import { useAuth } from '@/auth/useAuth';
import { useApprovals } from '@/store/approvals';
import { theme } from '@/theme/tokens';

export default function TabsLayout() {
  const credentials = useAuth((state) => state.credentials);
  const pending = useApprovals((state) => state.requests.length);
  const loadApprovals = useApprovals((state) => state.load);

  useEffect(() => {
    if (credentials) void loadApprovals();
  }, [credentials, loadApprovals]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.muted,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopWidth: 0 },
      }}
    >
      <Tabs.Screen name="chats" options={{ title: 'Chats' }} />
      <Tabs.Screen
        name="approvals"
        options={{
          title: 'Approvals',
          tabBarBadge: pending > 0 ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.colors.danger },
        }}
      />
      <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
