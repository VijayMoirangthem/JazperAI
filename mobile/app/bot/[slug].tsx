import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';

export default function BotCardScreen() {
  const { slug } = useLocalSearchParams();
  return (
    <View style={styles.container}>
      <Text>Bot Card Screen - {slug as string}</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0b',
    alignItems: 'center',
    justifyContent: 'center',
  },
});