import { registerRootComponent } from 'expo';

// Defines the background alert task at start-up (Android may start the app headless just to run it).
import './src/notifications/backgroundTask';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
