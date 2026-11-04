import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Href, useRouter } from 'expo-router';
import { Activity, HelpCircle, Puzzle, Settings, ShieldCheck, User } from 'lucide-react-native';
import { SheetScreen } from '@/components/ui/kit';
import { SheetRow } from '@/components/ui/SheetRow';
import { useApprovals } from '@/store/approvals';
import { useSettings } from '@/store/settings';
import { useAuth } from '@/auth/useAuth';
import { getAuthProvider } from '@/auth/AuthProvider';
import { initialsOf } from '@/utils/format';
import { theme } from '@/theme/tokens';

/** The sheet behind the avatar button on Home. */
export default function ProfileSheet() {
  const router = useRouter();
  const pending = useApprovals((s) => s.requests.length);
  const profileName = useSettings((s) => s.profileName);
  const deviceName = useAuth((s) => s.deviceName);
  const color = theme.colors.text;

  const go = (href: string) => () => {
    router.back();
    setTimeout(() => router.push(href as Href), 200);
  };

  const signOut = async () => {
    await getAuthProvider().signOut();
    router.dismissAll();
    router.replace('/welcome' as Href);
  };

  return (
    <SheetScreen>
      <View style={styles.head}>
        <View style={styles.avatar}>
          {profileName ? <Text style={styles.initials}>{initialsOf(profileName)}</Text> : <User size={26} color={theme.colors.muted} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {profileName || 'You'}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            Signed in on {deviceName ?? 'this phone'}
          </Text>
        </View>
      </View>
      <SheetRow label="Plugins" icon={<Puzzle size={20} color={color} />} onPress={go('/plugins')} />
      <SheetRow
        label="Approvals"
        icon={<ShieldCheck size={20} color={color} />}
        onPress={go('/(tabs)/approvals')}
        right={
          pending > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{pending}</Text>
            </View>
          ) : undefined
        }
      />
      <SheetRow label="Activity" icon={<Activity size={20} color={color} />} onPress={go('/(tabs)/activity')} />
      <SheetRow label="Settings" icon={<Settings size={20} color={color} />} onPress={go('/(tabs)/settings')} />
      <SheetRow label="Help" icon={<HelpCircle size={20} color={color} />} onPress={go('/(tabs)/settings')} subtitle="Jasper runs on your computer." />
      <View style={{ height: 8 }} />
      <Text onPress={signOut} style={styles.signOut} accessibilityRole="button" accessibilityLabel="Sign out">
        Sign out
      </Text>
    </SheetScreen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8, paddingVertical: 10 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: theme.colors.chipBg, alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: theme.fontSizes.lg, fontWeight: '600', color: theme.colors.text },
  name: { fontSize: theme.fontSizes.xl, fontWeight: '600', color: theme.colors.text },
  sub: { fontSize: theme.fontSizes.sm, color: theme.colors.muted, marginTop: 2 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: theme.colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  badgeText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  signOut: {
    textAlign: 'center',
    paddingVertical: 14,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: theme.colors.text,
    overflow: 'hidden',
    fontSize: theme.fontSizes.body,
    fontWeight: '600',
    color: theme.colors.text,
    marginHorizontal: 8,
  },
});
