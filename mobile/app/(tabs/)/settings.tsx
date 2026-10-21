import { View, StyleSheet, Alert } from 'react-native';
import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Constants } from 'expo-constants';
import { useAuth } from '@/auth/useAuth';
import { useSettings } from '@/store/settings';
import { clearCredentials } from '@/auth/secureStore';
import {
  Screen,
  Text,
  Button,
  Card,
  Divider,
  Chip,
  Switch as UISwitch,
} from '@/components/ui';

export default function SettingsScreen() {
  const router = useRouter();
  const { deviceName, deviceId, credentials, clear } = useAuth();
  const { appLock, setAppLock, notificationToggles, setNotificationToggle } = useSettings();

  useEffect(() => {
    if (!credentials) {
      router.replace('/(auth)/pair' as any);
    }
  }, [credentials, router]);

  const handleUnpair = () => {
    Alert.alert(
      'Unpair this phone?',
      'This will remove all credentials from this device. You will need to pair again to use the app.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: async () => {
            await clearCredentials();
            clear();
            router.replace('/(auth)/pair' as any);
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <View style={styles.container}>
        <Card style={styles.card}>
          <Text variant="title" style={styles.sectionTitle}>
            Paired Device
          </Text>
          <Divider />
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Device Name
            </Text>
            <Text variant="body" style={styles.value}>
              {deviceName ?? 'Unknown'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Device ID
            </Text>
            <Text variant="caption" style={styles.value} numberOfLines={1}>
              {deviceId ?? 'Unknown'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Server URL
            </Text>
            <Text variant="caption" style={styles.value} numberOfLines={1}>
              {credentials?.baseUrl ?? 'Unknown'}
            </Text>
          </View>
          <Button
            title="Unpair this phone"
            variant="danger"
            onPress={handleUnpair}
            style={styles.unpairButton}
          />
        </Card>

        <Card style={styles.card}>
          <Text variant="title" style={styles.sectionTitle}>
            Security
          </Text>
          <Divider />
          <View style={styles.settingRow}>
            <View>
              <Text variant="body">App Lock</Text>
              <Text variant="caption" style={styles.settingDescription}>
                Require biometrics to open the app
              </Text>
            </View>
            <UISwitch
              value={appLock}
              onValueChange={setAppLock}
              disabled={false}
              trackColor={{ false: '#333', true: '#2563eb' }}
              thumbColor={appLock ? '#2563eb' : '#fff'}
            />
          </View>
        </Card>

        <Card style={styles.card}>
          <Text variant="title" style={styles.sectionTitle}>
            Notifications
          </Text>
          <Divider />
          {(
            [
              { key: 'approvals', label: 'Approvals', description: 'New approval requests' },
              { key: 'mail', label: 'Important Mail', description: 'From Messenger' },
              { key: 'feature', label: 'Feature Runs', description: 'When a feature run finishes' },
              { key: 'alert', label: 'Alerts', description: 'System alerts' },
            ] as const
          ).map(({ key, label, description }) => (
            <View key={key} style={styles.settingRow}>
              <View style={styles.settingLabel}>
                <Text variant="body">{label}</Text>
                <Text variant="caption" style={styles.settingDescription}>
                  {description}
                </Text>
              </View>
              <UISwitch
                value={notificationToggles[key]}
                onValueChange={(v) => setNotificationToggle(key, v)}
                trackColor={{ false: '#333', true: '#2563eb' }}
                thumbColor={notificationToggles[key] ? '#2563eb' : '#fff'}
              />
            </View>
          ))}
        </Card>

        <Card style={styles.card}>
          <Text variant="title" style={styles.sectionTitle}>
            About
          </Text>
          <Divider />
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Version
            </Text>
            <Text variant="body" style={styles.value}>
              1.0.0
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text variant="caption" style={styles.label}>
              Expo SDK
            </Text>
            <Text variant="body" style={styles.value}>
              58
            </Text>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingBottom: 32,
  },
  card: {
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  label: {
    opacity: 0.6,
  },
  value: {
    textAlign: 'right',
    maxWidth: '60%',
  },
  unpairButton: {
    marginTop: 16,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.10)',
  },
  settingLabel: {
    flex: 1,
  },
  settingDescription: {
    marginTop: 2,
    opacity: 0.55,
  },
});