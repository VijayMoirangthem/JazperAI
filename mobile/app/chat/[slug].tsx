import { View, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { useLocalSearchParams } from 'expo-router';

export default function ChatScreen() {
  const { slug } = useLocalSearchParams();
  return (
    <Screen>
      <Text>Chat Screen - {slug as string}</Text>
    </Screen>
  );
}