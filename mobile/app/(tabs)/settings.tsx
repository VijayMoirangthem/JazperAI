import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { ChevronLeft } from 'lucide-react-native';
import { useAuth } from '@/auth/useAuth';
import { getAuthProvider } from '@/auth/AuthProvider';
import { useSettings } from '@/store/settings';
import { useChat } from '@/store/chat';
import { useHome } from '@/store/home';
import { eraseAllChats } from '@/db/meta';
import { CircleButton, SectionLabel, useToast } from '@/components/ui/kit';
import { ThemeMode, theme } from '@/theme/tokens';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <SectionLabel style={{ paddingHorizontal: 6 }}>{title}</SectionLabel>
      <View style={styles.group}>{children}</View>
    </View>
  );
}

function ToggleRow({ label, description, value, onChange }: { label: string; description?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description ? <Text style={styles.rowDesc}>{description}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ false: theme.colors.border, true: theme.colors.success }}
        thumbColor="#ffffff"
      />
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const toast = useToast((s) => s.show);
  const { deviceName, credentials } = useAuth();
  const s = useSettings();

  const eraseChats = () =>
    Alert.alert('Erase chats on this phone?', 'Your chats are only stored here. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Erase',
        style: 'destructive',
        onPress: () => {
          eraseAllChats();
          useChat.setState({ messagesByBot: {} });
          useHome.getState().refresh();
          toast('Chats erased');
        },
      },
    ]);

  const signOut = () =>
    Alert.alert('Sign out?', 'You will go back to the welcome screen.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await getAuthProvider().signOut();
          router.dismissAll();
          router.replace('/welcome' as Href);
        },
      },
    ]);

  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <CircleButton label="Back" onPress={() => router.back()}>
          <ChevronLeft size={22} color={theme.colors.text} />
        </CircleButton>
        <Text style={styles.title} accessibilityRole="header">
          Settings
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 40 }} showsVerticalScrollIndicator={false}>
        <Group title="Profile">
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Your name</Text>
            <TextInput value={s.profileName} onChangeText={s.setProfileName} placeholder="Add your name" placeholderTextColor={theme.colors.faint} style={styles.nameInput} accessibilityLabel="Your name" maxLength={40} />
          </View>
        </Group>

        <Group title="Appearance">
          <View style={[styles.row, { flexDirection: 'column', alignItems: 'stretch', gap: 10 }]}>
            <View style={styles.segment} accessibilityRole="radiogroup">
              {MODES.map((mode) => (
                <Pressable
                  key={mode.id}
                  onPress={() => {
                    s.setThemeMode(mode.id);
                    toast('Appearance applies the next time you open the app.');
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: s.themeMode === mode.id }}
                  accessibilityLabel={mode.label}
                  style={[styles.segmentItem, s.themeMode === mode.id && { backgroundColor: theme.colors.pill }]}
                >
                  <Text style={[styles.segmentText, s.themeMode === mode.id && { color: theme.colors.pillText }]}>{mode.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.rowDesc}>Light is the default. Changes apply the next time you open the app.</Text>
          </View>
        </Group>

        <Group title="Chat">
          <ToggleRow label="Read replies aloud" description="Speak each new reply in the bot's voice" value={s.readAloud} onChange={s.setReadAloud} />
          <ToggleRow label="Send voice notes as text" description="Send the transcript right away" value={s.voiceAutoSend} onChange={s.setVoiceAutoSend} />
          <ToggleRow label="Show tool details" description="Keep the list of steps open" value={s.showToolDetails} onChange={s.setShowToolDetails} />
        </Group>

        <Group title="Notifications">
          <ToggleRow label="Approvals" description="New approval requests" value={s.notificationToggles.approvals} onChange={(v) => s.setNotificationToggle('approvals', v)} />
          <ToggleRow label="Important mail" description="From Messenger" value={s.notificationToggles.mail} onChange={(v) => s.setNotificationToggle('mail', v)} />
          <ToggleRow label="Feature runs" description="When a run finishes" value={s.notificationToggles.feature} onChange={(v) => s.setNotificationToggle('feature', v)} />
          <ToggleRow label="Alerts" description="System alerts" value={s.notificationToggles.alert} onChange={(v) => s.setNotificationToggle('alert', v)} />
        </Group>

        <Group title="Security">
          <ToggleRow label="App lock" description="Ask for your fingerprint or face to open the app" value={s.appLock} onChange={s.setAppLock} />
          <Text style={[styles.rowDesc, { paddingHorizontal: 16, paddingBottom: 12 }]}>Big approvals always ask for your fingerprint, even when the app is unlocked.</Text>
        </Group>

        <Group title="Data">
          <Pressable onPress={eraseChats} style={styles.row} accessibilityRole="button" accessibilityLabel="Erase chats on this phone">
            <Text style={[styles.rowLabel, { color: theme.colors.danger }]}>Erase chats on this phone</Text>
          </Pressable>
        </Group>

        <Group title="Connection">
          <InfoRow label="Device" value={deviceName ?? 'This phone'} />
          <InfoRow label="Server" value={credentials?.baseUrl ?? '-'} />
          <Pressable onPress={() => router.push('/(auth)/pair' as Href)} style={styles.row} accessibilityRole="button" accessibilityLabel="Pair with a code">
            <Text style={styles.rowLabel}>Pair with a code</Text>
            <Text style={styles.rowDesc}>Advanced</Text>
          </Pressable>
        </Group>

        <Group title="About">
          <InfoRow label="Version" value={version} />
        </Group>

        <Pressable onPress={signOut} style={styles.signOut} accessibilityRole="button" accessibilityLabel="Sign out">
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.background },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 8 },
  title: { fontSize: theme.fontSizes.xl, fontWeight: '600', color: theme.colors.text },
  group: { backgroundColor: theme.colors.surface, borderRadius: 20, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 54, paddingHorizontal: 16, paddingVertical: 10 },
  rowLabel: { fontSize: theme.fontSizes.body, color: theme.colors.text },
  rowDesc: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 2 },
  rowValue: { fontSize: theme.fontSizes.base, color: theme.colors.muted, flexShrink: 1, maxWidth: '60%' },
  nameInput: { flex: 1, textAlign: 'right', fontSize: theme.fontSizes.body, color: theme.colors.text, padding: 0 },
  segment: { flexDirection: 'row', backgroundColor: theme.colors.chipBg, borderRadius: 14, padding: 3 },
  segmentItem: { flex: 1, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: theme.fontSizes.base, fontWeight: '600', color: theme.colors.text },
  signOut: { height: 52, borderRadius: 26, borderWidth: 1.5, borderColor: theme.colors.text, alignItems: 'center', justifyContent: 'center' },
  signOutText: { fontSize: theme.fontSizes.body, fontWeight: '600', color: theme.colors.text },
});
