import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useAuth } from '@/auth/useAuth';
import { useApprovals } from '@/store/approvals';

/** V2 has no tab bar: Home is the root and the other screens are plain stack screens. */
export default function MainLayout() {
  const credentials = useAuth((state) => state.credentials);
  const loadApprovals = useApprovals((state) => state.load);

  useEffect(() => {
    if (credentials) void loadApprovals();
  }, [credentials, loadApprovals]);

  return <Stack screenOptions={{ headerShown: false }} />;
}
