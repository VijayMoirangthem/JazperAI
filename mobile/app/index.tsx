import { Redirect, Href } from 'expo-router';
import { useAuth } from '@/auth/useAuth';

/** Launch routing: signed in -> Home, otherwise the Welcome screen. */
export default function Index() {
  const credentials = useAuth((state) => state.credentials);
  return <Redirect href={(credentials ? '/(tabs)/chats' : '/welcome') as Href} />;
}
