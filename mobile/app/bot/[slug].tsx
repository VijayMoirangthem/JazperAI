import { View, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { useLocalSearchParams } from 'expo-router';

export default function BotCardScreen() {
  const { slug } = useLocalSearchParams();
  return (
    <Screen>
      <Text>Bot Card Screen - {slug as string}</Text>
    </Screen>
  );
}