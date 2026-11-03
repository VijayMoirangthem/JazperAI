import { ExpoRoot } from 'expo-router';

const ctx = require.context('./app');

export default function App() {
  return <ExpoRoot context={ctx} />;
}
