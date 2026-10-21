import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';

export default function ChatsScreen() {
  return (
    <View style={styles.container}>
      <Text>Chats Screen - TODO</Text>
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