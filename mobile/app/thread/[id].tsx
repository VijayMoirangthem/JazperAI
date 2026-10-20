import { View, Text } from 'react-native';
import { Screen } from '@/components/ui/Screen';
import { useLocalSearchParams } from 'expo-router';

export default function ThreadScreen() {
  const { id } = useLocalSearchParams();
  return (
    <Screen>
      <Text>Thread Screen - {id as string}</Text>
    </Screen>
  );
}